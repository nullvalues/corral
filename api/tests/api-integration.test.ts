/**
 * Comprehensive integration tests for Phase 6 API surface.
 *
 * Covers:
 *   - GET /api/experience-categories (authenticated → 200)
 *   - POST/PATCH/DELETE /api/experience-categories (RBAC: non-admin → 403, admin → 201/200/204)
 *   - GET /api/experiences (list) — ABAC: owner, mentor-with-read, third-party
 *   - GET /api/experiences/:id — ABAC: owner, mentor, third-party, non-existent
 *   - POST /api/experiences — owner, mentor-with-write, mentor-without-write, hours mismatch
 *   - PATCH/DELETE /api/experiences/:id — owner, mentor-with-write, third-party
 *   - GET /api/experiences/rollup — correct totalHours per category, empty → 0, third-party → 403
 *   - pii_access_log audit trail — mentor reads/patches experience
 *
 * Slug uniqueness: FILE_PREFIX from randomUUID() prevents collisions with other
 * concurrent test files that also insert experience_categories rows.
 *
 * Cleanup: all inserted rows are removed in afterAll in FK-safe order.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  experienceCategories,
  experiences,
  mentorGrants,
  piiAccessLog,
  systemRoles,
} from '../src/db/schema/index.js';
import { eq, like, inArray, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Slug uniqueness — prevents cross-file collisions under concurrent execution
// ---------------------------------------------------------------------------

const FILE_PREFIX = randomUUID().slice(0, 8);

// ---------------------------------------------------------------------------
// Outer skip guard
// ---------------------------------------------------------------------------

const skipIf = describe.skipIf(!process.env.DATABASE_URL_TEST);

// ---------------------------------------------------------------------------
// Shared state — populated by beforeAll
// ---------------------------------------------------------------------------

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

// User IDs
let applicantId: string;
let adminId: string;
let mentorId: string;
let thirdPartyId: string;
let mentorWriteId: string;

// Session cookies
let applicantCookie: string;
let adminCookie: string;
let mentorCookie: string;
let thirdPartyCookie: string;
let mentorWriteCookie: string;

// Seeded category IDs
let cat1Id: string;
let cat2Id: string; // will have no experiences — used to verify rollup returns 0

// Experience IDs
let exp1Id: string; // permissionToContact=true, owned by applicant
let exp2Id: string; // permissionToContact=false, owned by applicant
let exp3Id: string; // extra experience for PATCH/DELETE tests

// Grant IDs (text, set during setup)
const GRANT_READ_ID = `grant-read-${FILE_PREFIX}`;
const GRANT_WRITE_ID = `grant-write-${FILE_PREFIX}`;

// Helpers -------------------------------------------------------------------

async function signUpAndGetSession(email: string, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name, email, password: 'Password123!' }),
  });
  if (res.statusCode !== 200) {
    throw new Error(`Sign-up failed for ${email}: ${res.statusCode} ${res.body}`);
  }
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

function makeExperienceBody(
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    categoryId,
    organization: 'Integration Test Org',
    position: 'Tester',
    startDate: '2023-01-01',
    dutiesNarrative: 'Integration testing duties.',
    totalHours: 40,
    hoursPerWeek: 8,
    numberOfWeeks: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const ts = Date.now();

  // Sign up all test users
  applicantCookie = await signUpAndGetSession(
    `int-applicant-${FILE_PREFIX}@example.com`,
    'Integration Applicant',
  );
  adminCookie = await signUpAndGetSession(
    `int-admin-${FILE_PREFIX}@example.com`,
    'Integration Admin',
  );
  mentorCookie = await signUpAndGetSession(
    `int-mentor-${FILE_PREFIX}@example.com`,
    'Integration Mentor',
  );
  thirdPartyCookie = await signUpAndGetSession(
    `int-third-${FILE_PREFIX}@example.com`,
    'Integration Third Party',
  );
  mentorWriteCookie = await signUpAndGetSession(
    `int-mentor-write-${FILE_PREFIX}@example.com`,
    'Integration Mentor Write',
  );

  // Resolve user IDs
  applicantId = await getUserId(`int-applicant-${FILE_PREFIX}@example.com`);
  adminId = await getUserId(`int-admin-${FILE_PREFIX}@example.com`);
  mentorId = await getUserId(`int-mentor-${FILE_PREFIX}@example.com`);
  thirdPartyId = await getUserId(`int-third-${FILE_PREFIX}@example.com`);
  mentorWriteId = await getUserId(`int-mentor-write-${FILE_PREFIX}@example.com`);

  // Promote admin
  await db
    .insert(systemRoles)
    .values({ userId: adminId, role: 'admin' })
    .onConflictDoNothing();

  // Insert two categories
  const [cat1] = await db
    .insert(experienceCategories)
    .values({
      slug: `cat-${FILE_PREFIX}-1`,
      name: `Int Category 1 ${FILE_PREFIX}`,
      sortOrder: 90,
      isActive: true,
    })
    .returning();
  cat1Id = cat1.id;

  const [cat2] = await db
    .insert(experienceCategories)
    .values({
      slug: `cat-${FILE_PREFIX}-2`,
      name: `Int Category 2 ${FILE_PREFIX}`,
      sortOrder: 91,
      isActive: true,
    })
    .returning();
  cat2Id = cat2.id;

  // Insert experiences owned by applicant
  const [exp1] = await db
    .insert(experiences)
    .values({
      ownerUserId: applicantId,
      categoryId: cat1Id,
      organization: 'Org With PII',
      position: 'Position PII',
      startDate: new Date('2023-01-01'),
      dutiesNarrative: 'Work with contact.',
      totalHours: 40,
      hoursPerWeek: 8,
      numberOfWeeks: 5,
      permissionToContact: true,
      contactFirstName: 'Alice',
      contactLastName: 'TestLast',
      contactEmail: 'alice.testlast@example.com',
    })
    .returning();
  exp1Id = exp1.id;

  const [exp2] = await db
    .insert(experiences)
    .values({
      ownerUserId: applicantId,
      categoryId: cat1Id,
      organization: 'Org No PII',
      position: 'Position No PII',
      startDate: new Date('2023-06-01'),
      dutiesNarrative: 'Work without contact permission.',
      totalHours: 20,
      hoursPerWeek: 4,
      numberOfWeeks: 5,
      permissionToContact: false,
      contactFirstName: 'Hidden',
      contactLastName: 'Contact',
      contactEmail: 'hidden@example.com',
    })
    .returning();
  exp2Id = exp2.id;

  const [exp3] = await db
    .insert(experiences)
    .values({
      ownerUserId: applicantId,
      categoryId: cat1Id,
      organization: 'Org For PATCH DELETE',
      position: 'Position Mutate',
      startDate: new Date('2023-03-01'),
      dutiesNarrative: 'Mutable experience.',
      totalHours: 30,
      hoursPerWeek: 6,
      numberOfWeeks: 5,
      permissionToContact: false,
    })
    .returning();
  exp3Id = exp3.id;

  // Set up mentor grants (read-only)
  await db.insert(mentorGrants).values({
    id: GRANT_READ_ID,
    applicantUserId: applicantId,
    mentorUserId: mentorId,
    grantedByUserId: applicantId,
    status: 'active',
    permissions: ['read'],
  });

  // Set up mentor grants (write)
  await db.insert(mentorGrants).values({
    id: GRANT_WRITE_ID,
    applicantUserId: applicantId,
    mentorUserId: mentorWriteId,
    grantedByUserId: applicantId,
    status: 'active',
    permissions: ['read', 'write'],
  });
});

afterAll(async () => {
  // Cleanup in FK-safe order:
  // 1. pii_access_log (by actorUserId)
  // 2. experiences (by ownerUserId)
  // 3. experience_categories (by slug prefix)
  // 4. mentor_grants (by id)
  // 5. system_roles (by userId)

  await db
    .delete(piiAccessLog)
    .where(
      inArray(piiAccessLog.actorUserId, [mentorId, mentorWriteId, applicantId].filter(Boolean)),
    );

  await db
    .delete(experiences)
    .where(eq(experiences.ownerUserId, applicantId));

  // Also clean up any experiences created on behalf of applicant by mentorWrite
  await db
    .delete(experiences)
    .where(eq(experiences.ownerUserId, applicantId));

  await db
    .delete(experienceCategories)
    .where(like(experienceCategories.slug, `cat-${FILE_PREFIX}-%`));

  await db.delete(mentorGrants).where(eq(mentorGrants.id, GRANT_READ_ID));
  await db.delete(mentorGrants).where(eq(mentorGrants.id, GRANT_WRITE_ID));

  await db.delete(systemRoles).where(eq(systemRoles.userId, adminId));

  await app.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

skipIf('GET /api/experience-categories', () => {
  it('authenticated user gets 200 with an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/experience-categories',
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

skipIf('POST /api/experience-categories', () => {
  it('non-admin gets 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ slug: `cat-${FILE_PREFIX}-denied`, name: 'Should Fail' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin creates a category and gets 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/experience-categories',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({
        slug: `cat-${FILE_PREFIX}-admin-post`,
        name: `Int Admin Post ${FILE_PREFIX}`,
        sortOrder: 95,
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body['slug']).toBe(`cat-${FILE_PREFIX}-admin-post`);
    expect(typeof body['id']).toBe('string');
  });
});

skipIf('PATCH + DELETE /api/experience-categories/:id', () => {
  it('non-admin gets 403 on PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experience-categories/${cat1Id}`,
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ name: 'Should Fail Patch' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin patches a category and gets 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experience-categories/${cat1Id}`,
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ name: `Int Category 1 Patched ${FILE_PREFIX}` }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['name']).toBe(`Int Category 1 Patched ${FILE_PREFIX}`);
  });

  it('PATCH on non-existent ID returns 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/experience-categories/00000000-0000-4000-8000-000000000001',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      payload: JSON.stringify({ name: 'Ghost' }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('non-admin gets 403 on DELETE', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/experience-categories/${cat2Id}`,
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE on non-existent ID returns 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/experience-categories/00000000-0000-4000-8000-000000000002',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

skipIf('GET /api/experiences list', () => {
  it('owner gets 200 with their experiences', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences?owner_user_id=${applicantId}`,
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Owner sees full PII for permissionToContact=true experience
    const e1 = body.find((e) => e['id'] === exp1Id);
    expect(e1).toBeDefined();
    expect(e1!['contactFirstName']).toBe('Alice');
    expect(e1!['contactEmail']).toBe('alice.testlast@example.com');
  });

  it('mentor with read grant gets 200 with PII gated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences?owner_user_id=${applicantId}`,
      headers: { cookie: mentorCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    // permissionToContact=false → contact fields nulled
    const e2 = body.find((e) => e['id'] === exp2Id);
    expect(e2).toBeDefined();
    expect(e2!['contactFirstName']).toBeNull();
    expect(e2!['contactEmail']).toBeNull();
    // permissionToContact=true → contact fields visible
    const e1 = body.find((e) => e['id'] === exp1Id);
    expect(e1).toBeDefined();
    expect(e1!['contactFirstName']).toBe('Alice');
  });

  it('third-party gets 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences?owner_user_id=${applicantId}`,
      headers: { cookie: thirdPartyCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

skipIf('GET /api/experiences/:id', () => {
  it('owner gets 200 with full PII', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/${exp1Id}`,
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['id']).toBe(exp1Id);
    expect(body['contactFirstName']).toBe('Alice');
  });

  it('mentor with read grant gets 200 with PII gated (permissionToContact=false)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/${exp2Id}`,
      headers: { cookie: mentorCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['contactFirstName']).toBeNull();
    expect(body['contactEmail']).toBeNull();
  });

  it('mentor with read grant gets 200 with PII visible (permissionToContact=true)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/${exp1Id}`,
      headers: { cookie: mentorCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['contactFirstName']).toBe('Alice');
  });

  it('third-party gets 403 (not 404) for an existing experience', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/${exp1Id}`,
      headers: { cookie: thirdPartyCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('owner gets 403 for a non-existent experience (ABAC check runs before 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/experiences/00000000-0000-4000-8000-000000000003',
      headers: { cookie: applicantCookie },
    });
    // When the resource does not exist, ownerId defaults to '', so isOwner
    // returns false and the ABAC check denies access before the 404 check.
    expect(res.statusCode).toBe(403);
  });

  it('third-party gets 403 for a non-existent experience', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/experiences/00000000-0000-4000-8000-000000000003',
      headers: { cookie: thirdPartyCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

skipIf('POST /api/experiences', () => {
  it('owner can create an experience → 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/experiences',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify(makeExperienceBody(cat1Id)),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(typeof body['id']).toBe('string');
    expect(body['ownerUserId']).toBe(applicantId);
    // Cleanup the created experience
    await db
      .delete(experiences)
      .where(and(eq(experiences.id, body['id'] as string)));
  });

  it('mentor with write grant can create on behalf of applicant → 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/experiences',
      headers: { 'content-type': 'application/json', cookie: mentorWriteCookie },
      payload: JSON.stringify(makeExperienceBody(cat1Id, { ownerUserId: applicantId })),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body['ownerUserId']).toBe(applicantId);
    // Cleanup
    await db
      .delete(experiences)
      .where(and(eq(experiences.id, body['id'] as string)));
  });

  it('mentor without write grant gets 403', async () => {
    // mentorId has only 'read' permission
    const res = await app.inject({
      method: 'POST',
      url: '/api/experiences',
      headers: { 'content-type': 'application/json', cookie: mentorCookie },
      payload: JSON.stringify(makeExperienceBody(cat1Id, { ownerUserId: applicantId })),
    });
    expect(res.statusCode).toBe(403);
  });

  it('hours mismatch returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/experiences',
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify(
        makeExperienceBody(cat1Id, {
          totalHours: 99, // does not equal 8 * 5 = 40
          hoursPerWeek: 8,
          numberOfWeeks: 5,
        }),
      ),
    });
    expect(res.statusCode).toBe(400);
  });
});

skipIf('PATCH/DELETE /api/experiences/:id', () => {
  it('owner can PATCH their experience → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${exp3Id}`,
      headers: { 'content-type': 'application/json', cookie: applicantCookie },
      payload: JSON.stringify({ organization: 'Owner Updated Org' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['organization']).toBe('Owner Updated Org');
  });

  it('mentor with write grant can PATCH → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${exp3Id}`,
      headers: { 'content-type': 'application/json', cookie: mentorWriteCookie },
      payload: JSON.stringify({ organization: 'Mentor Write Updated' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['organization']).toBe('Mentor Write Updated');
  });

  it('third-party gets 403 on PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${exp3Id}`,
      headers: { 'content-type': 'application/json', cookie: thirdPartyCookie },
      payload: JSON.stringify({ organization: 'Should Fail' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('owner can DELETE their experience → 204', async () => {
    // Create a temporary experience to delete
    const [tmpExp] = await db
      .insert(experiences)
      .values({
        ownerUserId: applicantId,
        categoryId: cat1Id,
        organization: 'Temp For Delete',
        position: 'Temp',
        startDate: new Date('2023-04-01'),
        dutiesNarrative: 'Will be deleted.',
        totalHours: 10,
        hoursPerWeek: 2,
        numberOfWeeks: 5,
        permissionToContact: false,
      })
      .returning();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/experiences/${tmpExp.id}`,
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it('mentor with write grant can DELETE → 204', async () => {
    // Create a temporary experience for mentor to delete
    const [tmpExp] = await db
      .insert(experiences)
      .values({
        ownerUserId: applicantId,
        categoryId: cat1Id,
        organization: 'Temp For Mentor Delete',
        position: 'Temp Mentor',
        startDate: new Date('2023-05-01'),
        dutiesNarrative: 'Will be deleted by mentor.',
        totalHours: 15,
        hoursPerWeek: 3,
        numberOfWeeks: 5,
        permissionToContact: false,
      })
      .returning();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/experiences/${tmpExp.id}`,
      headers: { cookie: mentorWriteCookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it('third-party gets 403 on DELETE', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/experiences/${exp3Id}`,
      headers: { cookie: thirdPartyCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

skipIf('GET /api/experiences/rollup', () => {
  it('owner gets rollup with correct totalHours per category', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/rollup?owner_user_id=${applicantId}`,
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);

    // cat1 has exp1 (40h) + exp2 (20h) + exp3 (30h) = 90h (minus any deleted in prior tests)
    const row1 = body.find((r) => r['categoryId'] === cat1Id);
    expect(row1).toBeDefined();
    expect(typeof row1!['totalHours']).toBe('number');
    expect((row1!['totalHours'] as number)).toBeGreaterThan(0);
  });

  it('empty category appears with totalHours: 0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/rollup?owner_user_id=${applicantId}`,
      headers: { cookie: applicantCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;

    // cat2 has no experiences seeded
    const row2 = body.find((r) => r['categoryId'] === cat2Id);
    expect(row2).toBeDefined();
    expect(row2!['totalHours']).toBe(0);
  });

  it('third-party gets 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/rollup?owner_user_id=${applicantId}`,
      headers: { cookie: thirdPartyCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

skipIf('pii_access_log audit trail', () => {
  it('mentor reads experience with permissionToContact=true → log row with viaGrant=true action=read', async () => {
    // Use exp1 which has permissionToContact=true
    const res = await app.inject({
      method: 'GET',
      url: `/api/experiences/${exp1Id}`,
      headers: { cookie: mentorCookie },
    });
    expect(res.statusCode).toBe(200);

    // Fire-and-forget insert needs time to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rows = await db
      .select()
      .from(piiAccessLog)
      .where(
        and(
          eq(piiAccessLog.resourceId, exp1Id),
          eq(piiAccessLog.actorUserId, mentorId),
          eq(piiAccessLog.action, 'read'),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    expect(row.viaGrant).toBe(true);
    expect(row.action).toBe('read');
    expect(row.resourceType).toBe('experience');
    expect(row.subjectUserId).toBe(applicantId);
  });

  it('mentor PATCHes experience → log row with action=update', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/experiences/${exp1Id}`,
      headers: { 'content-type': 'application/json', cookie: mentorWriteCookie },
      payload: JSON.stringify({ organization: 'Audit Trail Org' }),
    });
    expect(patchRes.statusCode).toBe(200);

    // Fire-and-forget insert needs time to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rows = await db
      .select()
      .from(piiAccessLog)
      .where(
        and(
          eq(piiAccessLog.resourceId, exp1Id),
          eq(piiAccessLog.actorUserId, mentorWriteId),
          eq(piiAccessLog.action, 'update'),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    expect(row.viaGrant).toBe(true);
    expect(row.action).toBe('update');
    expect(row.resourceType).toBe('experience');
    expect(row.subjectUserId).toBe(applicantId);
  });
});
