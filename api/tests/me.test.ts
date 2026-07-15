/**
 * Unit tests for GET /api/me (API-023).
 *
 * Route path is /api/me (not /api/auth/me) — see routes/me.ts header comment
 * for why the /auth/me path is not used.
 *
 * Unit project — no DATABASE_URL_TEST required. Tests exercise:
 *   - 401 when unauthenticated
 *   - 200 with correct user/roles/hasMentorGrants structure when authenticated
 *   - hasMentorGrants = true when active mentor grant exists
 *   - hasMentorGrants = false when no active mentor grants exist
 *   - roles is populated from system_roles
 *
 * The DB is mocked so no live connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports.
//
// Select chain patterns in services/me.ts:
//   getMyRoles:               db.select().from().where()         — awaited directly
//   getHasActiveMentorGrants: db.select().from().where().limit() — awaited via limit()
//
// Strategy: make `where` return a thenable that also exposes `.limit()`.
//   - getMyRoles awaits where-result directly → resolves via then()
//   - getHasActiveMentorGrants calls .limit() on the where-result → limitMock resolves
// ---------------------------------------------------------------------------

const { limitMock, whereMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  whereMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: whereMock,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ME_USER_ID = 'user-me-1';

/**
 * Mock an authenticated session.  `twoFactorEnabled: true` bypasses mfaGate
 * so the route handler is reached.
 */
function mockSession(opts: { id?: string; twoFactorEnabled?: boolean } = {}) {
  const userId = opts.id ?? ME_USER_ID;
  const fakeUser = {
    id: userId,
    name: 'Test User',
    email: 'test@example.com',
    twoFactorEnabled: opts.twoFactorEnabled ?? true,
  };
  const fakeSession = { id: 'sess-me', userId, token: 'tok-me' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
}

/**
 * Configure the db.where() mock for the two sequential calls made by the handler.
 *
 * Call 1 (getMyRoles):               awaited directly → resolves via then()
 * Call 2 (getHasActiveMentorGrants): calls .limit(1)  → resolved by limitMock
 */
function mockDbForMe(
  rolesResult: Array<{ role: string }>,
  hasGrantsRows: Array<{ id: string }>,
) {
  // First where() call: getMyRoles — awaited directly
  whereMock.mockImplementationOnce(() => ({
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(rolesResult).then(resolve),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve(rolesResult).catch(reject),
    limit: vi.fn(),
  }));

  // Second where() call: getHasActiveMentorGrants — .limit(1) called, then awaited
  whereMock.mockImplementationOnce(() => ({
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(hasGrantsRows).then(resolve),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve(hasGrantsRows).catch(reject),
    limit: limitMock.mockResolvedValueOnce(hasGrantsRows),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/me — unit', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    whereMock.mockReset();
    limitMock.mockReset();
    // Default: empty roles and no mentor grants
    whereMock.mockImplementation(() => ({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve([]).then(resolve),
      catch: (reject: (e: unknown) => unknown) =>
        Promise.resolve([]).catch(reject),
      limit: limitMock.mockResolvedValue([]),
    }));
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with correct shape when authenticated', async () => {
    mockSession();
    mockDbForMe([{ role: 'applicant' }], []);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        user: { id: string; email: string; name: string };
        roles: string[];
        hasMentorGrants: boolean;
      };
      expect(body).toHaveProperty('user');
      expect(body.user.id).toBe(ME_USER_ID);
      expect(body.user.email).toBe('test@example.com');
      expect(body.user.name).toBe('Test User');
      expect(body).toHaveProperty('roles');
      expect(body).toHaveProperty('hasMentorGrants');
    } finally {
      await app.close();
    }
  });

  it('returns roles from system_roles for the authenticated user', async () => {
    mockSession();
    mockDbForMe([{ role: 'admin' }, { role: 'applicant' }], []);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { roles: string[] };
      expect(body.roles).toContain('admin');
      expect(body.roles).toContain('applicant');
      expect(body.roles).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('returns hasMentorGrants = true when an active grant exists', async () => {
    mockSession();
    mockDbForMe([], [{ id: 'grant-uuid-1' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { hasMentorGrants: boolean };
      expect(body.hasMentorGrants).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('returns hasMentorGrants = false when no active grants exist', async () => {
    mockSession();
    mockDbForMe([], []);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { hasMentorGrants: boolean };
      expect(body.hasMentorGrants).toBe(false);
    } finally {
      await app.close();
    }
  });
});
