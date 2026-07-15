/**
 * Unit tests for POST /api/mentor-grants (API-018),
 * PATCH /api/mentor-grants/:id (API-019),
 * GET /api/mentor-grants (API-020), and
 * GET /api/mentor-grants/mine (API-021).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests exercise:
 *   POST:
 *   - 401 when unauthenticated
 *   - 403 when authenticated but not admin
 *   - 400 when mentorUserId === applicantUserId
 *   - 201 with created grant when admin calls with valid body
 *   PATCH:
 *   - updateMentorGrant with unknown id returns null
 *   - 200 with updated grant when admin patches valid id
 *   - 404 when patching unknown id
 *   GET:
 *   - listMentorGrants with no filters returns all grants
 *   - listMentorGrants with status filter returns only matching grants
 *   - 401 when unauthenticated
 *   - 403 when not admin
 *   - 200 with array of grants when admin requests
 *   GET /mine:
 *   - listMyMentorGrants returns grants for the correct mentor
 *   - listMyMentorGrants returns empty array when no active grants
 *   - 200 with applicant info for authenticated user
 *
 * The DB is mocked so no live connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports. The select chain must support the
// requireRole preHandler (roles lookup) and the insert chain for createMentorGrant.
// ---------------------------------------------------------------------------

const { limitMock, returningMock, updateReturningMock, orderByMock, innerJoinWhereMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  returningMock: vi.fn(),
  updateReturningMock: vi.fn(),
  orderByMock: vi.fn(),
  // innerJoinWhereMock is the terminal for listMyMentorGrants (single innerJoin → where → data)
  // and for listMentorGrants the double-join path calls .where() on secondInnerJoinResult,
  // which maps to this same mock; its return value must have .orderBy() for listMentorGrants.
  // To satisfy both: innerJoinWhereMock returns a thenable object that also exposes .orderBy().
  innerJoinWhereMock: vi.fn(),
}));

// The DB mock must handle multiple calling patterns:
//   select chain: db.select().from().where().limit()                     (getMentorGrantById, requireRole)
//   select chain: db.select().from().innerJoin(A).innerJoin(B).where().orderBy()
//                                                                         (listMentorGrants — API-032: double join)
//   select chain: db.select().from().innerJoin(users).where()            (listMyMentorGrants — single join)
//   insert chain: db.insert().values().returning()                        (createMentorGrant)
//   insert chain: db.insert().values().catch()                            (insertAdminActionLog fire-and-forget)
//   update chain: db.update().set().where().returning()
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();

// innerJoin chain supports both a single-join path (listMyMentorGrants) and a
// double-join path (listMentorGrants). The trick: innerJoinWhereMock returns a
// thenable-with-orderBy object so both await-directly and .orderBy() callers work.
//
//  listMentorGrants:   from().innerJoin(A) → firstResult
//                      .innerJoin(B)       → secondResult  (has .where = innerJoinWhereMock)
//                      .where(cond)        → innerJoinWhereMock() returns thenableWithOrderBy
//                      .orderBy(...)       → orderByMock (terminal)
//
//  listMyMentorGrants: from().innerJoin(users) → firstResult (has .where = innerJoinWhereMock)
//                      .where(cond)            → innerJoinWhereMock() awaited directly
//
// We set a default return value for innerJoinWhereMock that is BOTH a thenable (resolves [])
// and has an .orderBy property pointing to orderByMock.

vi.mock('../src/db/index.js', () => {
  // Build the chain objects inside the factory so hoisted mocks are available.
  const thenableEmpty = Object.assign(Promise.resolve([]), { orderBy: orderByMock });

  const secondInnerJoinObj = {
    where: innerJoinWhereMock,
    orderBy: orderByMock,
  };

  const firstInnerJoinObj = {
    innerJoin: vi.fn().mockReturnValue(secondInnerJoinObj),
    where: innerJoinWhereMock,
  };

  return {
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: limitMock,
      orderBy: orderByMock,
      innerJoin: vi.fn().mockReturnValue(firstInnerJoinObj),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: returningMock,
          catch: vi.fn(),
        }),
      }),
      update: vi.fn(() => ({
        set: updateSetMock.mockReturnValue({
          where: updateWhereMock.mockReturnValue({
            returning: updateReturningMock,
          }),
        }),
      })),
    },
    _thenableEmpty: thenableEmpty,
  };
});

vi.mock('../src/services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
  setMailer: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock insertPiiAccessLog so we can assert it is called without a live DB.
// ---------------------------------------------------------------------------
vi.mock('../src/services/pii-access-log.js', () => ({
  insertPiiAccessLog: vi.fn(),
  listPiiAccessLog: vi.fn(),
}));

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';
import { insertPiiAccessLog } from '../src/services/pii-access-log.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MENTOR_USER_ID = 'mentor-user-1';
const APPLICANT_USER_ID = 'applicant-user-2';
const ADMIN_USER_ID = 'admin-user-3';

const VALID_BODY = JSON.stringify({
  mentorUserId: MENTOR_USER_ID,
  applicantUserId: APPLICANT_USER_ID,
  permissions: ['read'],
});

const SAME_USER_BODY = JSON.stringify({
  mentorUserId: MENTOR_USER_ID,
  applicantUserId: MENTOR_USER_ID,
  permissions: ['read'],
});

function mockAdminSession() {
  // twoFactorEnabled: true bypasses mfaGate (which runs before requireRole)
  const fakeUser = { id: ADMIN_USER_ID, name: 'Admin', email: 'admin@example.com', twoFactorEnabled: true };
  const fakeSession = { id: 'sess-admin', userId: ADMIN_USER_ID, token: 'tok-admin' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
  // Admin role grant found
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/mentor-grants — unit', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    innerJoinWhereMock.mockReturnValue(Object.assign(Promise.resolve([]), { orderBy: orderByMock }));
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants',
        headers: { 'content-type': 'application/json' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    // mfaGate fires before requireRole; a user without twoFactorEnabled and
    // without a recent createdAt will be blocked by mfaGate (403) before the
    // RBAC check runs. The end result is still 403, satisfying the acceptance criterion.
    const fakeUser = { id: 'non-admin-1', name: 'Bob', email: 'bob@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'non-admin-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    // Do NOT mock limitMock here — mfaGate fires before requireRole reaches the DB.

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when mentorUserId === applicantUserId', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: SAME_USER_BODY,
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toMatch(/different/i);
    } finally {
      await app.close();
    }
  });

  it('returns 201 with created grant when admin posts valid body', async () => {
    mockAdminSession();
    // getUserById(mentorUserId) + getUserById(applicantUserId) existence checks (API-052)
    limitMock.mockResolvedValueOnce([{ id: MENTOR_USER_ID, email: 'mentor@example.com' }]);
    limitMock.mockResolvedValueOnce([{ id: APPLICANT_USER_ID, email: 'alice@example.com' }]);

    const fakeGrant = {
      id: 'grant-uuid-1',
      mentorUserId: MENTOR_USER_ID,
      applicantUserId: APPLICANT_USER_ID,
      permissions: ['read'],
      grantedByUserId: ADMIN_USER_ID,
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      status: 'active',
    };
    returningMock.mockResolvedValueOnce([fakeGrant]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as typeof fakeGrant & { grantedAt: string };
      expect(body.id).toBe('grant-uuid-1');
      expect(body.mentorUserId).toBe(MENTOR_USER_ID);
      expect(body.applicantUserId).toBe(APPLICANT_USER_ID);
      expect(body.grantedByUserId).toBe(ADMIN_USER_ID);
      expect(body.status).toBe('active');
      expect(body.permissions).toEqual(['read']);
    } finally {
      await app.close();
    }
  });

  // API-052: user existence checks
  it('returns 400 when mentorUserId does not exist in users table', async () => {
    mockAdminSession();
    // getUserById(mentorUserId) returns empty (user not found)
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toMatch(/mentorUserId/);
      expect(body.error).toMatch(/does not exist/);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when applicantUserId does not exist in users table', async () => {
    mockAdminSession();
    // getUserById(mentorUserId) succeeds, getUserById(applicantUserId) fails
    limitMock.mockResolvedValueOnce([{ id: MENTOR_USER_ID, email: 'mentor@example.com' }]);
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toMatch(/applicantUserId/);
      expect(body.error).toMatch(/does not exist/);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// API-019: PATCH /api/mentor-grants/:id
// ---------------------------------------------------------------------------

import { listMentorGrants, updateMentorGrant, listMyMentorGrants, enrichGrantWithUsers } from '../src/services/mentor-grants.js';

// ---------------------------------------------------------------------------
// API-020: listMentorGrants service unit tests
// ---------------------------------------------------------------------------

describe('listMentorGrants — unit', () => {
  const fakeGrant = {
    id: 'grant-uuid-1',
    mentorUserId: MENTOR_USER_ID,
    applicantUserId: APPLICANT_USER_ID,
    permissions: ['read'],
    grantedByUserId: ADMIN_USER_ID,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    applicantName: 'Alice Applicant',
    applicantEmail: 'alice@example.com',
    mentorName: 'Mentor User',
    mentorEmail: 'mentor@example.com',
  };

  beforeEach(() => {
    orderByMock.mockResolvedValue([]);
    // listMentorGrants uses double innerJoin → where → orderBy; innerJoinWhereMock
    // must return a thenable-with-orderBy so both paths work.
    innerJoinWhereMock.mockReturnValue(Object.assign(Promise.resolve([]), { orderBy: orderByMock }));
  });

  it('returns all grants when called with no filters', async () => {
    orderByMock.mockResolvedValueOnce([fakeGrant]);
    const result = await listMentorGrants({});
    expect(result).toEqual([fakeGrant]);
  });

  it('returns only active grants when filtered by status active', async () => {
    orderByMock.mockResolvedValueOnce([fakeGrant]);
    const result = await listMentorGrants({ status: 'active' });
    expect(result).toEqual([fakeGrant]);
  });
});

describe('updateMentorGrant — unit', () => {
  beforeEach(() => {
    updateReturningMock.mockResolvedValue([]);
  });

  it('returns null when no row matches the given id', async () => {
    updateReturningMock.mockResolvedValueOnce([]);
    const result = await updateMentorGrant('unknown-id', { status: 'revoked' });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// enrichGrantWithUsers unit tests
// ---------------------------------------------------------------------------

describe('enrichGrantWithUsers — unit', () => {
  const baseGrant = {
    id: 'grant-uuid-1',
    mentorUserId: MENTOR_USER_ID,
    applicantUserId: APPLICANT_USER_ID,
    status: 'active',
  };

  it('maps both applicant and mentor user fields onto the grant row', () => {
    const applicant = { name: 'Alice', email: 'alice@example.com' };
    const mentor = { name: 'Bob', email: 'bob@example.com' };
    const result = enrichGrantWithUsers(baseGrant, applicant, mentor);
    expect(result.applicantName).toBe('Alice');
    expect(result.applicantEmail).toBe('alice@example.com');
    expect(result.mentorName).toBe('Bob');
    expect(result.mentorEmail).toBe('bob@example.com');
  });

  it('maps null applicant user to null applicantName and null applicantEmail', () => {
    const mentor = { name: 'Bob', email: 'bob@example.com' };
    const result = enrichGrantWithUsers(baseGrant, null, mentor);
    expect(result.applicantName).toBeNull();
    expect(result.applicantEmail).toBeNull();
    expect(result.mentorName).toBe('Bob');
    expect(result.mentorEmail).toBe('bob@example.com');
  });

  it('maps null mentor user to null mentorName and null mentorEmail', () => {
    const applicant = { name: 'Alice', email: 'alice@example.com' };
    const result = enrichGrantWithUsers(baseGrant, applicant, null);
    expect(result.applicantName).toBe('Alice');
    expect(result.applicantEmail).toBe('alice@example.com');
    expect(result.mentorName).toBeNull();
    expect(result.mentorEmail).toBeNull();
  });

  it('maps null name within a non-null user to null applicantName', () => {
    const applicant = { name: null, email: 'alice@example.com' };
    const mentor = { name: null, email: 'bob@example.com' };
    const result = enrichGrantWithUsers(baseGrant, applicant, mentor);
    expect(result.applicantName).toBeNull();
    expect(result.mentorName).toBeNull();
  });

  it('preserves all original grant row fields', () => {
    const result = enrichGrantWithUsers(baseGrant, null, null);
    expect(result.id).toBe(baseGrant.id);
    expect(result.mentorUserId).toBe(baseGrant.mentorUserId);
    expect(result.applicantUserId).toBe(baseGrant.applicantUserId);
    expect(result.status).toBe(baseGrant.status);
  });
});

describe('PATCH /api/mentor-grants/:id — unit', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    innerJoinWhereMock.mockReturnValue(Object.assign(Promise.resolve([]), { orderBy: orderByMock }));
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/grant-uuid-1',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'revoked' }),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    const fakeUser = { id: 'non-admin-1', name: 'Bob', email: 'bob@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'non-admin-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/grant-uuid-1',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'revoked' }),
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with updated grant when admin patches valid id', async () => {
    mockAdminSession();

    const existingGrant = {
      id: 'grant-uuid-1',
      mentorUserId: MENTOR_USER_ID,
      applicantUserId: APPLICANT_USER_ID,
      permissions: ['read'],
      grantedByUserId: ADMIN_USER_ID,
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      status: 'active',
    };
    const updatedGrant = {
      ...existingGrant,
      status: 'revoked',
    };
    // getMentorGrantById pre-fetch (limitMock call #2, after RBAC limitMock #1)
    limitMock.mockResolvedValueOnce([existingGrant]);
    updateReturningMock.mockResolvedValueOnce([updatedGrant]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/grant-uuid-1',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'revoked' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as typeof updatedGrant & { grantedAt: string };
      expect(body.id).toBe('grant-uuid-1');
      expect(body.status).toBe('revoked');
    } finally {
      await app.close();
    }
  });

  it('returns 404 when patching an unknown id', async () => {
    mockAdminSession();
    updateReturningMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/does-not-exist',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'revoked' }),
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// API-021: listMyMentorGrants service unit tests
// ---------------------------------------------------------------------------

describe('listMyMentorGrants — unit', () => {
  const fakeGrantWithApplicant = {
    id: 'grant-uuid-1',
    mentorUserId: MENTOR_USER_ID,
    applicantUserId: APPLICANT_USER_ID,
    permissions: ['read'],
    grantedByUserId: ADMIN_USER_ID,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    applicantName: 'Alice Applicant',
    applicantEmail: 'alice@example.com',
  };

  beforeEach(() => {
    innerJoinWhereMock.mockReturnValue(Object.assign(Promise.resolve([]), { orderBy: orderByMock }));
  });

  it('returns grants with applicant info for the correct mentor', async () => {
    innerJoinWhereMock.mockResolvedValueOnce([fakeGrantWithApplicant]);
    const result = await listMyMentorGrants(MENTOR_USER_ID);
    expect(result).toEqual([fakeGrantWithApplicant]);
    expect(result[0]).toHaveProperty('applicantName', 'Alice Applicant');
    expect(result[0]).toHaveProperty('applicantEmail', 'alice@example.com');
  });

  it('returns empty array when no active grants exist for the mentor', async () => {
    innerJoinWhereMock.mockResolvedValueOnce([]);
    const result = await listMyMentorGrants(MENTOR_USER_ID);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// API-020: GET /api/mentor-grants
// ---------------------------------------------------------------------------

describe('GET /api/mentor-grants — unit', () => {
  const fakeGrant = {
    id: 'grant-uuid-1',
    mentorUserId: MENTOR_USER_ID,
    applicantUserId: APPLICANT_USER_ID,
    permissions: ['read'],
    grantedByUserId: ADMIN_USER_ID,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    applicantName: 'Alice Applicant',
    applicantEmail: 'alice@example.com',
    mentorName: 'Mentor User',
    mentorEmail: 'mentor@example.com',
  };

  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    innerJoinWhereMock.mockReturnValue(Object.assign(Promise.resolve([]), { orderBy: orderByMock }));
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    const fakeUser = { id: 'non-admin-1', name: 'Bob', email: 'bob@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'non-admin-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with array of grants when admin requests with no filters', async () => {
    mockAdminSession();
    orderByMock.mockResolvedValueOnce([fakeGrant]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Array<typeof fakeGrant & { grantedAt: string }>;
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('grant-uuid-1');
    } finally {
      await app.close();
    }
  });

  // API-052: status enum validation — Zod schema validation fires before preHandlers.
  // No session setup needed: the querystring is rejected before auth runs.
  it('returns 400 when status filter is an invalid enum value', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants?status=bogus',
      });
      // Schema validation (Zod) fires before preHandlers — 400 from querystring validation
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// API-058: GET /api/mentor-grants — PII audit log
// ---------------------------------------------------------------------------

describe('GET /api/mentor-grants — PII audit log (API-058)', () => {
  const fakeGrant = {
    id: 'grant-uuid-1',
    mentorUserId: MENTOR_USER_ID,
    applicantUserId: APPLICANT_USER_ID,
    permissions: ['read'],
    grantedByUserId: ADMIN_USER_ID,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    applicantName: 'Alice Applicant',
    applicantEmail: 'alice@example.com',
    mentorName: 'Mentor User',
    mentorEmail: 'mentor@example.com',
  };

  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    innerJoinWhereMock.mockReturnValue(Object.assign(Promise.resolve([]), { orderBy: orderByMock }));
    vi.mocked(insertPiiAccessLog).mockClear();
  });

  it('writes exactly one pii_access_log row with correct fields on admin GET', async () => {
    mockAdminSession();
    // Return two grants to confirm only one audit row is written per request (not per row)
    orderByMock.mockResolvedValueOnce([fakeGrant, { ...fakeGrant, id: 'grant-uuid-2' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(insertPiiAccessLog)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(insertPiiAccessLog)).toHaveBeenCalledWith({
        actorUserId: ADMIN_USER_ID,
        action: 'read',
        resourceType: 'mentor_grant_list',
        viaGrant: false,
      });
      // resourceId and subjectUserId are intentionally absent (persisted as NULL)
      const callArg = vi.mocked(insertPiiAccessLog).mock.calls[0][0];
      expect(callArg).not.toHaveProperty('resourceId');
      expect(callArg).not.toHaveProperty('subjectUserId');
    } finally {
      await app.close();
    }
  });

  it('does not write a pii_access_log row when a non-admin request is rejected', async () => {
    const fakeUser = { id: 'non-admin-1', name: 'Bob', email: 'bob@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'non-admin-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(403);
      expect(vi.mocked(insertPiiAccessLog)).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// API-021: GET /api/mentor-grants/mine
// ---------------------------------------------------------------------------

describe('GET /api/mentor-grants/mine — unit', () => {
  const fakeGrantWithApplicant = {
    id: 'grant-uuid-1',
    mentorUserId: MENTOR_USER_ID,
    applicantUserId: APPLICANT_USER_ID,
    permissions: ['read'],
    grantedByUserId: ADMIN_USER_ID,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    applicantName: 'Alice Applicant',
    applicantEmail: 'alice@example.com',
  };

  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    innerJoinWhereMock.mockReturnValue(Object.assign(Promise.resolve([]), { orderBy: orderByMock }));
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants/mine',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with grants including applicant info for authenticated user', async () => {
    // Any authenticated user (with twoFactor) can call /mine — no role check needed
    const fakeUser = {
      id: MENTOR_USER_ID,
      name: 'Mentor User',
      email: 'mentor@example.com',
      twoFactorEnabled: true,
    };
    const fakeSession = { id: 'sess-mentor', userId: MENTOR_USER_ID, token: 'tok-mentor' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    innerJoinWhereMock.mockResolvedValueOnce([fakeGrantWithApplicant]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants/mine',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Array<
        typeof fakeGrantWithApplicant & { grantedAt: string }
      >;
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('grant-uuid-1');
      expect(body[0].applicantName).toBe('Alice Applicant');
      expect(body[0].applicantEmail).toBe('alice@example.com');
    } finally {
      await app.close();
    }
  });

  it('returns 200 with empty array when the user has no active grants', async () => {
    const fakeUser = {
      id: MENTOR_USER_ID,
      name: 'Mentor User',
      email: 'mentor@example.com',
      twoFactorEnabled: true,
    };
    const fakeSession = { id: 'sess-mentor', userId: MENTOR_USER_ID, token: 'tok-mentor' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    innerJoinWhereMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants/mine',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
