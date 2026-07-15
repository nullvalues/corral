/**
 * Unit tests for API-029: GET /api/users?page=N&pageSize=M
 *
 * Tests exercise:
 *   - 200 with paginated user list shape when admin calls ?page=1&pageSize=20
 *   - 400 when page is missing but pageSize is present (and no email)
 *   - 400 when pageSize is missing but page is present (and no email)
 *   - 400 when page < 1
 *   - 400 when pageSize > 100
 *   - 403 for non-admin caller
 *   - 401 for unauthenticated caller
 *   - listUsers service returns UserListResult with aggregated roles and counts
 *   - listUsers correctly deduplicates users with multiple roles
 *   - listUsers treats null role as empty roles array
 *   - listUsers coerces activeMentorGrantCount to number
 *
 * The DB is mocked; no live DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports.
// ---------------------------------------------------------------------------
//
// DB query chain patterns in play:
//   RBAC guard:      db.select().from().where().limit()      → terminates with limitMock
//   count query:     db.select().from()                      → awaitable via thenableMock (for count)
//   rows query:      db.select().from().leftJoin()...        → awaitable via offsetMock
//
// Strategy: the `where` mock returns a thenable+limit combo.
// The `from` mock returns an object that is:
//   - thenable (so count query `await db.select().from()` works) via countMock
//   - has leftJoin chain for rows query → terminates with offsetMock
//   - has where for RBAC guard → terminates with limitMock
//
// Mock call tracking: countMock and offsetMock are called in listUsers;
// limitMock is called by RBAC guard.

const { limitMock, offsetMock, countMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  offsetMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockImplementation(() => ({
      // Thenable: for count query — `const [row] = await db.select().from(users)`
      then: (resolve: (v: unknown) => unknown, _reject: (e: unknown) => unknown) =>
        Promise.resolve(countMock()).then(resolve),
      catch: (fn: (e: unknown) => unknown) =>
        Promise.resolve(countMock()).catch(fn),
      // RBAC guard chain
      where: vi.fn().mockImplementation(() => ({
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(countMock()).then(resolve),
        catch: (fn: (e: unknown) => unknown) =>
          Promise.resolve(countMock()).catch(fn),
        limit: limitMock,
      })),
      // rows query chain
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue({
        offset: offsetMock,
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        catch: vi.fn(),
      }),
    }),
  },
}));

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
import { listUsers } from '../src/services/users.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin-user-1';

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
  // RBAC guard: db.select().from().where().limit() → admin row
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

// ---------------------------------------------------------------------------
// GET /api/users?page=&pageSize= — route tests
// ---------------------------------------------------------------------------

describe('GET /api/users?page=&pageSize= — unit (API-029)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockReset();
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockReset();
    limitMock.mockResolvedValue([]);
    countMock.mockReset();
    countMock.mockResolvedValue([]);
    offsetMock.mockReset();
    offsetMock.mockResolvedValue([]);
  });

  it('returns 200 with paginated shape when admin calls ?page=1&pageSize=20', async () => {
    mockAdminSession();
    // count query
    countMock.mockResolvedValueOnce([{ total: 2 }]);
    // rows query
    offsetMock.mockResolvedValueOnce([
      {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'applicant',
        activeMentorGrantCount: '1',
      },
      {
        id: 'user-2',
        email: 'bob@example.com',
        name: 'Bob',
        role: 'admin',
        activeMentorGrantCount: '0',
      },
    ]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?page=1&pageSize=20',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        users: Array<{
          id: string;
          email: string;
          name: string;
          roles: string[];
          activeMentorGrantCount: number;
        }>;
        totalCount: number;
        page: number;
        pageSize: number;
      };
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalCount).toBe(2);
      expect(Array.isArray(body.users)).toBe(true);
      expect(body.users).toHaveLength(2);
      expect(body.users[0].id).toBe('user-1');
      expect(body.users[0].roles).toEqual(['applicant']);
      expect(body.users[0].activeMentorGrantCount).toBe(1);
      expect(body.users[1].id).toBe('user-2');
      expect(body.users[1].roles).toEqual(['admin']);
      expect(body.users[1].activeMentorGrantCount).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when only page is given without pageSize (and no email)', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?page=1',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when only pageSize is given without page (and no email)', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?pageSize=20',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when page < 1', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?page=0&pageSize=20',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when pageSize > 100', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?page=1&pageSize=101',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when caller does not have admin role', async () => {
    const fakeUser = { id: 'non-admin-1', name: 'Bob', email: 'bob@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'non-admin-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    // RBAC guard returns no admin row
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?page=1&pageSize=20',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 401 when no session is present', async () => {
    // auth.api.getSession returns null by default (set in beforeEach)
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?page=1&pageSize=20',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// listUsers service — unit tests
// ---------------------------------------------------------------------------

describe('listUsers — unit (API-029)', () => {
  beforeEach(() => {
    countMock.mockResolvedValue([]);
    offsetMock.mockResolvedValue([]);
    limitMock.mockResolvedValue([]);
  });

  it('returns empty users array when no users exist', async () => {
    countMock.mockResolvedValueOnce([{ total: 0 }]);
    offsetMock.mockResolvedValueOnce([]);

    const result = await listUsers(1, 20);
    expect(result.totalCount).toBe(0);
    expect(result.users).toEqual([]);
  });

  it('aggregates multiple roles for the same user', async () => {
    countMock.mockResolvedValueOnce([{ total: 1 }]);
    offsetMock.mockResolvedValueOnce([
      {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'applicant',
        activeMentorGrantCount: '0',
      },
      {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'admin',
        activeMentorGrantCount: '0',
      },
    ]);

    const result = await listUsers(1, 20);
    expect(result.totalCount).toBe(1);
    expect(result.users).toHaveLength(1);
    expect(result.users[0].roles).toContain('applicant');
    expect(result.users[0].roles).toContain('admin');
    expect(result.users[0].roles).toHaveLength(2);
  });

  it('returns empty roles array when user has no system_roles row (null role)', async () => {
    countMock.mockResolvedValueOnce([{ total: 1 }]);
    offsetMock.mockResolvedValueOnce([
      {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        role: null,
        activeMentorGrantCount: '0',
      },
    ]);

    const result = await listUsers(1, 20);
    expect(result.users[0].roles).toEqual([]);
  });

  it('coerces activeMentorGrantCount from string to number', async () => {
    countMock.mockResolvedValueOnce([{ total: 1 }]);
    offsetMock.mockResolvedValueOnce([
      {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'applicant',
        activeMentorGrantCount: '3',
      },
    ]);

    const result = await listUsers(1, 20);
    expect(result.users[0].activeMentorGrantCount).toBe(3);
    expect(typeof result.users[0].activeMentorGrantCount).toBe('number');
  });
});
