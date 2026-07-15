/**
 * Integration tests for API-016: PATCH /api/experiences/:id must not allow
 * ownerUserId in the request body (ownership reassignment vulnerability fix).
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test.
 *
 * Tests verify:
 *   - PATCH with ownerUserId in body does NOT change the experience's ownerUserId
 *     (the field is silently ignored — it is not present in PatchExperienceBody)
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { experiences, experienceCategories } from '../src/db/schema/index.js';
import { inArray } from 'drizzle-orm';

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
    payload: JSON.stringify({ name: 'API-016 User', email, password: 'Password123!' }),
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

function makePostBody(categoryId: string) {
  return {
    categoryId,
    organization: 'Original Org',
    position: 'Original Position',
    startDate: '2023-01-01',
    dutiesNarrative: 'Original duties narrative.',
    totalHours: 40,
    hoursPerWeek: 8,
    numberOfWeeks: 5,
  };
}

async function seedCategory(slug: string) {
  const [category] = await db
    .insert(experienceCategories)
    .values({ slug, name: 'API016 Category', sortOrder: 99, isActive: true })
    .returning();
  return category;
}

// ---------------------------------------------------------------------------
// Security: PATCH with ownerUserId in body must NOT reassign ownership
// ---------------------------------------------------------------------------

describe('PATCH /api/experiences/:id — ownerUserId in body is silently ignored (API-016)', () => {
  it('does not change ownerUserId when ownerUserId is included in the PATCH body', async () => {
    const app = await buildApp();
    const expIds: string[] = [];
    const catIds: string[] = [];
    try {
      const ownerEmail = `api016-owner+${Date.now()}@example.com`;
      const otherEmail = `api016-other+${Date.now()}@example.com`;

      // Sign up two users — owner and an unrelated "other" user
      const ownerCookie = await signUpAndGetSession(app, ownerEmail);
      await signUpAndGetSession(app, otherEmail);
      const otherId = await getUserId(otherEmail);

      const category = await seedCategory(`api016-cat-${Date.now()}`);
      catIds.push(category.id);

      // Owner creates an experience
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json', cookie: ownerCookie },
        payload: JSON.stringify(makePostBody(category.id)),
      });
      expect(createRes.statusCode).toBe(201);
      const created = createRes.json() as Record<string, unknown>;
      const expId = created['id'] as string;
      expIds.push(expId);
      const originalOwnerUserId = created['ownerUserId'] as string;

      // Owner patches with ownerUserId set to the other user's ID
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${expId}`,
        headers: { 'content-type': 'application/json', cookie: ownerCookie },
        payload: JSON.stringify({ ownerUserId: otherId, organization: 'Patched Org' }),
      });

      // PATCH must succeed (200) — ownerUserId is silently dropped, not rejected
      expect(patchRes.statusCode).toBe(200);
      const patched = patchRes.json() as Record<string, unknown>;

      // organization update was applied
      expect(patched['organization']).toBe('Patched Org');

      // ownerUserId must remain the original owner — not the injected value
      expect(patched['ownerUserId']).toBe(originalOwnerUserId);
      expect(patched['ownerUserId']).not.toBe(otherId);
    } finally {
      if (expIds.length) await db.delete(experiences).where(inArray(experiences.id, expIds));
      if (catIds.length)
        await db.delete(experienceCategories).where(inArray(experienceCategories.id, catIds));
      await app.close();
    }
  });
});
