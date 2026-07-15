/**
 * Integration tests for roster-level PII access log (API-027).
 *
 * These tests run in the "integration" Vitest project, which requires
 * DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup.
 *
 * Tests verify:
 *   - An applicant calls GET /api/experiences with no experiences having
 *     permissionToContact=true; one pii_access_log row is written with
 *     action='read' and resourceId=null (ADR-031, closes CER-012).
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experiences,
  experienceCategories,
  piiAccessLog,
} from '../src/db/schema/index.js';
import { eq, inArray, and, isNull } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUpAndGetSession(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'PII Log User', email, password: 'Password123!' }),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function getUserId(email: string): Promise<string> {
  const result = await db.execute<{ id: string }>(
    `SELECT id FROM users WHERE email = '${email}' LIMIT 1`,
  );
  const rows = result as Array<{ id: string }>;
  if (!rows.length) throw new Error(`User not found: ${email}`);
  return rows[0].id;
}

async function seedCategory(slug: string) {
  const [category] = await db
    .insert(experienceCategories)
    .values({ slug, name: `PII027 Category ${slug}`, sortOrder: 99, isActive: true })
    .returning();
  return category;
}

/** Wait briefly for the fire-and-forget insert to settle. */
async function waitForAuditLog(ms = 200): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test: applicant calls GET /api/experiences — roster-level log row is written
// even when no experiences have permissionToContact=true
// ---------------------------------------------------------------------------

describe('GET /api/experiences — roster-level pii_access_log (API-027, ADR-031)', () => {
  it('writes one pii_access_log row with action=read and resourceId=null', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    const logIds: string[] = [];
    try {
      const ts = Date.now();
      const applicantEmail = `api027-app-roster+${ts}@example.com`;

      const applicantCookie = await signUpAndGetSession(app, applicantEmail);
      const applicantId = await getUserId(applicantEmail);

      const category = await seedCategory(`api027-cat-roster-${ts}`);
      catIds.push(category.id);

      // Create an experience with permissionToContact=false (the default)
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json', cookie: applicantCookie },
        payload: JSON.stringify({
          categoryId: category.id,
          organization: 'Roster Test Org',
          position: 'Roster Test Position',
          startDate: '2023-01-01',
          dutiesNarrative: 'Roster test duties.',
          totalHours: 40,
          hoursPerWeek: 8,
          numberOfWeeks: 5,
          permissionToContact: false,
        }),
      });
      expect(createRes.statusCode).toBe(201);
      const createdExp = createRes.json() as Record<string, unknown>;
      expIds.push(createdExp['id'] as string);

      // Applicant calls GET /api/experiences for their own roster
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/experiences?owner_user_id=${applicantId}`,
        headers: { cookie: applicantCookie },
      });
      expect(listRes.statusCode).toBe(200);

      // Wait for fire-and-forget insert to settle
      await waitForAuditLog();

      // Query the audit log: expect the roster-level row with resourceId=null
      const rows = await db
        .select()
        .from(piiAccessLog)
        .where(
          and(
            eq(piiAccessLog.actorUserId, applicantId),
            eq(piiAccessLog.action, 'read'),
            eq(piiAccessLog.resourceType, 'experience'),
            isNull(piiAccessLog.resourceId),
          ),
        );

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[0];
      expect(row.actorUserId).toBe(applicantId);
      expect(row.action).toBe('read');
      expect(row.resourceType).toBe('experience');
      expect(row.resourceId).toBeNull();
      expect(row.subjectUserId).toBe(applicantId);
      expect(row.viaGrant).toBe(false);

      logIds.push(...rows.map((r) => r.id));
    } finally {
      if (logIds.length) await db.delete(piiAccessLog).where(inArray(piiAccessLog.id, logIds));
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});
