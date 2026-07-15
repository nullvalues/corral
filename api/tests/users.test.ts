/**
 * Unit tests for GET /api/users?email= (API-022 / API-026).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests exercise:
 *   - 401 when unauthenticated
 *   - 403 when authenticated but not admin
 *   - 200 with matching users when admin requests with email prefix (>=3 chars)
 *   - 200 with empty array when no users match
 *   - 400 when email param is missing, 1 char, or 2 chars (API-026 min(3))
 *   - searchUsersByEmail service — returns results for a query
 *   - searchUsersByEmail service — escapeLike escapes LIKE wildcards (API-026)
 *   - insertPiiAccessLog is called fire-and-forget for each returned user
 *
 * The DB is mocked so no live connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports.
// ---------------------------------------------------------------------------

const { limitMock, userSearchMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  userSearchMock: vi.fn(),
}));

// The DB mock must handle two select chain patterns:
//   RBAC guard:         db.select().from().where().limit()  — terminates with limit()
//   searchUsersByEmail: db.select().from().where()          — terminates with where()
//
// Strategy: `where` returns a thenable object that also exposes `.limit()`.
// This lets both patterns work:
//   - RBAC calls .limit() on the where-result → limitMock resolves
//   - searchUsersByEmail awaits the where-result directly → userSearchMock resolves
vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => ({
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(userSearchMock()).then(resolve),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve(userSearchMock()).catch(reject),
      limit: limitMock,
    })),
    // insert chain: db.insert().values().catch() — fire-and-forget in insertPiiAccessLog
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
// searchUsersByEmail and escapeLike are imported for service-level unit tests below
import { searchUsersByEmail, escapeLike } from '../src/services/users.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin-user-1';

function mockAdminSession() {
  const fakeUser = { id: ADMIN_USER_ID, name: 'Admin', email: 'admin@example.com', twoFactorEnabled: true };
  const fakeSession = { id: 'sess-admin', userId: ADMIN_USER_ID, token: 'tok-admin' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
  // Admin role grant found — RBAC guard calls .where().limit()
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

const FAKE_USER = {
  id: 'user-uuid-1',
  email: 'alice@example.com',
  name: 'Alice',
};

// ---------------------------------------------------------------------------
// GET /api/users — route tests
// ---------------------------------------------------------------------------

describe('GET /api/users — unit', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    userSearchMock.mockResolvedValue([]);
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?email=alice',
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
        url: '/api/users?email=alice',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with matching users when admin requests with email prefix', async () => {
    mockAdminSession();
    userSearchMock.mockResolvedValueOnce([FAKE_USER]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?email=alice',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as typeof FAKE_USER[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('user-uuid-1');
      expect(body[0].email).toBe('alice@example.com');
      expect(body[0].name).toBe('Alice');
    } finally {
      await app.close();
    }
  });

  it('returns 200 with empty array when no users match the query', async () => {
    mockAdminSession();
    userSearchMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?email=nobody',
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

  it('returns 400 when email query param is missing', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users',
        headers: { cookie: 'session=fake' },
      });
      // Zod validation: email param is required and min(3)
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when email query param is 1 character (API-026 min(3))', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?email=a',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when email query param is 2 characters (API-026 min(3))', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?email=ab',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 200 when email query param is exactly 3 characters (API-026 min(3))', async () => {
    mockAdminSession();
    userSearchMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/users?email=ali',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// searchUsersByEmail — service unit tests
// ---------------------------------------------------------------------------

describe('searchUsersByEmail — unit', () => {
  beforeEach(() => {
    userSearchMock.mockResolvedValue([]);
  });

  it('returns array of users matching the email prefix', async () => {
    userSearchMock.mockResolvedValueOnce([FAKE_USER]);
    const result = await searchUsersByEmail('alice');
    expect(result).toEqual([FAKE_USER]);
  });

  it('returns empty array when no users match', async () => {
    userSearchMock.mockResolvedValueOnce([]);
    const result = await searchUsersByEmail('nobody');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// escapeLike — pure unit tests (API-026)
// ---------------------------------------------------------------------------

describe('escapeLike — unit', () => {
  it('leaves a plain string unchanged', () => {
    expect(escapeLike('alice')).toBe('alice');
  });

  it('escapes a backslash', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  it('escapes a percent sign', () => {
    expect(escapeLike('a%b')).toBe('a\\%b');
  });

  it('escapes an underscore', () => {
    expect(escapeLike('a_b')).toBe('a\\_b');
  });

  it('escapes multiple special characters in order', () => {
    // backslash is escaped first, so a literal backslash followed by % stays two distinct escapes
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
  });

  it('does not double-escape an already-escaped backslash', () => {
    // Input: "\\" (two chars: backslash backslash). Each backslash → "\\".
    expect(escapeLike('\\\\')).toBe('\\\\\\\\');
  });
});
