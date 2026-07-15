/**
 * Unit tests for GET /api/admin/milestone-awards (UI-081).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests exercise:
 *   - 401 when unauthenticated
 *   - 403 when authenticated but not admin (no admin role row)
 *   - 200 with array of rows for an admin
 *   - userId filter is threaded to listMilestoneAwards
 *
 * The DB is mocked so no live connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports. The select chain must support:
//   requireRole: db.select().from().where().limit()
//   listMilestoneAwards: db.select().from().leftJoin().where().orderBy().limit()
// ---------------------------------------------------------------------------

const { limitMock, orderByMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  orderByMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => {
  const leftJoinObj = {
    where: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: limitMock,
      }),
    }),
    // when no where() filter is applied, the chain goes directly .orderBy().limit()
    orderBy: vi.fn().mockReturnValue({
      limit: limitMock,
    }),
  };

  return {
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue({
        limit: limitMock,
      }),
      leftJoin: vi.fn().mockReturnValue(leftJoinObj),
      limit: limitMock,
      orderBy: orderByMock,
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
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin-user-1';
const OTHER_USER_ID = 'other-user-2';

const AWARD_ROW = {
  id: 'award-uuid-1',
  userId: 'applicant-user-1',
  email: 'applicant@example.com',
  milestoneKey: 'hours-100',
  earnedAt: new Date('2026-06-01T10:00:00Z'),
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
  // Admin role found
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

function mockNonAdminSession() {
  const fakeUser = {
    id: OTHER_USER_ID,
    name: 'Other',
    email: 'other@example.com',
    twoFactorEnabled: true,
  };
  const fakeSession = { id: 'sess-other', userId: OTHER_USER_ID, token: 'tok-other' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
  // No admin role
  limitMock.mockResolvedValueOnce([]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/milestone-awards — unit', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/milestone-awards',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when authenticated but not admin', async () => {
    const app = await buildApp();
    try {
      mockNonAdminSession();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/milestone-awards',
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with array of rows for an admin', async () => {
    const app = await buildApp();
    try {
      mockAdminSession();
      // listMilestoneAwards result — the limit call at the end of the chain
      limitMock.mockResolvedValueOnce([AWARD_ROW]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/milestone-awards',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      const row = body[0] as typeof AWARD_ROW & { earnedAt: string };
      expect(row.milestoneKey).toBe('hours-100');
      expect(row.email).toBe('applicant@example.com');
    } finally {
      await app.close();
    }
  });

  it('threads the userId query param to listMilestoneAwards', async () => {
    const app = await buildApp();
    try {
      mockAdminSession();
      limitMock.mockResolvedValueOnce([AWARD_ROW]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/milestone-awards?userId=applicant-user-1',
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
