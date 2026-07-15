/**
 * Unit tests for API-032 — Admin grant review queue.
 *
 * Covers:
 *   GET /api/mentor-grants?status=pending
 *   - returns only pending grants (filtered via the status query param)
 *   - response includes applicantName, applicantEmail, mentorName, mentorEmail
 *   - non-admin caller receives 403
 *
 *   PATCH /api/mentor-grants/:id — approve (pending → active)
 *   - returns 200 with updated grant
 *   - fires grant_update audit log (always)
 *   - fires grant_review audit log (only when existing.status === 'pending')
 *
 *   PATCH /api/mentor-grants/:id — reject (pending → revoked)
 *   - returns 200 with updated grant
 *   - fires grant_update audit log
 *   - fires grant_review audit log
 *
 *   PATCH /api/mentor-grants/:id — update on non-pending grant
 *   - fires grant_update audit log only (NOT grant_review)
 *
 * Unit project — no DATABASE_URL_TEST required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { limitMock, returningMock, updateReturningMock, orderByMock, insertMock, innerJoinWhereMock } =
  vi.hoisted(() => ({
    limitMock: vi.fn(),
    returningMock: vi.fn(),
    updateReturningMock: vi.fn(),
    orderByMock: vi.fn(),
    insertMock: vi.fn(),
    innerJoinWhereMock: vi.fn(),
  }));

// DB mock: supports the double innerJoin chain used by listMentorGrants (API-032).
// listMentorGrants: select().from().innerJoin(A).innerJoin(B).where().orderBy()
// getMentorGrantById: select().from().where().limit()
// insertAdminActionLog: insert().values() — awaited (API-035 change)
vi.mock('../src/db/index.js', () => {
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
      insert: insertMock.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: returningMock,
          // thenable so `await db.insert().values()` resolves (insertAdminActionLog)
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
          catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
          finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
        }),
      }),
      update: vi.fn(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: updateReturningMock,
          }),
        }),
      })),
    },
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

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MENTOR_USER_ID = 'mentor-user-api032';
const APPLICANT_USER_ID = 'applicant-user-api032';
const ADMIN_USER_ID = 'admin-user-api032';

const PENDING_GRANT = {
  id: 'grant-pending-1',
  mentorUserId: MENTOR_USER_ID,
  applicantUserId: APPLICANT_USER_ID,
  permissions: [] as string[],
  grantedByUserId: APPLICANT_USER_ID,
  grantedAt: new Date('2026-06-01T00:00:00.000Z'),
  status: 'pending',
  requestedByUserId: APPLICANT_USER_ID,
  applicantName: 'Alice Applicant',
  applicantEmail: 'alice@example.com',
  mentorName: 'Mentor User',
  mentorEmail: 'mentor@example.com',
};

const ACTIVE_GRANT = {
  id: 'grant-active-1',
  mentorUserId: MENTOR_USER_ID,
  applicantUserId: APPLICANT_USER_ID,
  permissions: ['read:experiences'] as string[],
  grantedByUserId: ADMIN_USER_ID,
  grantedAt: new Date('2026-06-01T00:00:00.000Z'),
  status: 'active',
  requestedByUserId: null,
  applicantName: 'Alice Applicant',
  applicantEmail: 'alice@example.com',
  mentorName: 'Mentor User',
  mentorEmail: 'mentor@example.com',
};

function mockAdminSession() {
  const fakeUser = {
    id: ADMIN_USER_ID,
    name: 'Admin',
    email: 'admin@example.com',
    twoFactorEnabled: true,
  };
  const fakeSession = { id: 'sess-admin', userId: ADMIN_USER_ID, token: 'tok-admin' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
  // Admin role lookup (limitMock call #1 after session)
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

// ---------------------------------------------------------------------------
// GET /api/mentor-grants?status=pending
// ---------------------------------------------------------------------------

describe('GET /api/mentor-grants?status=pending — API-032 unit', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    insertMock.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    });
    // innerJoinWhereMock returns a thenable with orderBy so double-join chain works
    innerJoinWhereMock.mockReturnValue(
      Object.assign(Promise.resolve([]), { orderBy: orderByMock }),
    );
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
        url: '/api/mentor-grants?status=pending',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with pending grants including applicant and mentor info', async () => {
    mockAdminSession();
    orderByMock.mockResolvedValueOnce([PENDING_GRANT]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants?status=pending',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Array<typeof PENDING_GRANT & { grantedAt: string }>;
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].status).toBe('pending');
      expect(body[0].applicantName).toBe('Alice Applicant');
      expect(body[0].applicantEmail).toBe('alice@example.com');
      expect(body[0].mentorName).toBe('Mentor User');
      expect(body[0].mentorEmail).toBe('mentor@example.com');
    } finally {
      await app.close();
    }
  });

  it('returns 200 with all grants when no status filter is provided', async () => {
    mockAdminSession();
    orderByMock.mockResolvedValueOnce([PENDING_GRANT, ACTIVE_GRANT]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor-grants',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Array<{ status: string }>;
      expect(body).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/mentor-grants/:id — grant_review audit log for pending transitions
// ---------------------------------------------------------------------------

describe('PATCH /api/mentor-grants/:id — grant_review audit log (API-032)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    innerJoinWhereMock.mockReturnValue(
      Object.assign(Promise.resolve([]), { orderBy: orderByMock }),
    );
    insertMock.mockReset().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    });
  });

  it('approve: pending → active fires grant_update AND grant_review (2 audit inserts)', async () => {
    mockAdminSession();
    // getMentorGrantById returns pending grant
    limitMock.mockResolvedValueOnce([PENDING_GRANT]);
    // updateMentorGrant returns activated grant
    updateReturningMock.mockResolvedValueOnce([{ ...PENDING_GRANT, status: 'active' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/grant-pending-1',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'active' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { status: string };
      expect(body.status).toBe('active');
      // grant_update + grant_review = 2 audit log inserts
      expect(insertMock).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('reject: pending → revoked fires grant_update AND grant_review (2 audit inserts)', async () => {
    mockAdminSession();
    limitMock.mockResolvedValueOnce([PENDING_GRANT]);
    updateReturningMock.mockResolvedValueOnce([{ ...PENDING_GRANT, status: 'revoked' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/grant-pending-1',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'revoked' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { status: string };
      expect(body.status).toBe('revoked');
      // grant_update + grant_review = 2 audit log inserts
      expect(insertMock).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('update on active grant fires only grant_update (1 audit insert, no grant_review)', async () => {
    mockAdminSession();
    limitMock.mockResolvedValueOnce([ACTIVE_GRANT]);
    updateReturningMock.mockResolvedValueOnce([{ ...ACTIVE_GRANT, status: 'revoked' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/grant-active-1',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'revoked' }),
      });
      expect(res.statusCode).toBe(200);
      // only grant_update, no grant_review since existing status is 'active' not 'pending'
      expect(insertMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when grant does not exist and fires no audit log', async () => {
    mockAdminSession();
    // getMentorGrantById returns nothing
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/no-such-id',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'active' }),
      });
      expect(res.statusCode).toBe(404);
      expect(insertMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
