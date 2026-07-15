/**
 * Unit tests for API-035 — route layer.
 *
 * Covers:
 *   - CER-029: PATCH /api/users/:id/roles returns 400 when :id > 36 chars
 *   - CER-026: route maps setAdminRole's 404 to HTTP 404
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { setAdminRoleMock, limitMock } = vi.hoisted(() => ({
  setAdminRoleMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock('../src/services/users.js', () => ({
  searchUsersByEmail: vi.fn().mockResolvedValue([]),
  listUsers: vi.fn().mockResolvedValue({ users: [], totalCount: 0 }),
  setAdminRole: setAdminRoleMock,
  getUserRoles: vi.fn().mockResolvedValue([]),
  escapeLike: (s: string) => s,
}));

vi.mock('../src/services/adminActionLog.js', () => ({
  insertAdminActionLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
  setMailer: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => ({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(limitMock()).then(resolve),
      catch: (reject: (e: unknown) => unknown) =>
        Promise.resolve(limitMock()).catch(reject),
      limit: limitMock,
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    transaction: vi.fn(),
  },
}));

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin-user-api035';

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
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

// ---------------------------------------------------------------------------
// CER-029: Route param length validation
// ---------------------------------------------------------------------------

describe('PATCH /api/users/:id/roles — route unit (API-035)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAdminRoleMock.mockResolvedValue(undefined);
  });

  it('CER-029: returns 400 when :id is longer than 36 characters', async () => {
    mockAdminSession();
    const app = await buildApp();
    try {
      const longId = 'a'.repeat(37);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/users/${longId}/roles`,
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ role: 'admin', action: 'grant' }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('CER-029: accepts :id of exactly 36 characters (UUID-length)', async () => {
    mockAdminSession();
    const app = await buildApp();
    try {
      const validId = 'a'.repeat(36);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/users/${validId}/roles`,
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ role: 'admin', action: 'grant' }),
      });
      expect(res.statusCode).not.toBe(400);
    } finally {
      await app.close();
    }
  });

  it('CER-029: accepts :id of 21 characters (nanoid BA length)', async () => {
    mockAdminSession();
    const app = await buildApp();
    try {
      const nanoId = 'a'.repeat(21);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/users/${nanoId}/roles`,
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ role: 'admin', action: 'grant' }),
      });
      expect(res.statusCode).not.toBe(400);
    } finally {
      await app.close();
    }
  });

  it('CER-026: route maps statusCode 404 from service to HTTP 404', async () => {
    mockAdminSession();
    const err = Object.assign(new Error('User not found'), { statusCode: 404 });
    setAdminRoleMock.mockRejectedValueOnce(err);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/users/${'x'.repeat(21)}/roles`,
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ role: 'admin', action: 'grant' }),
      });
      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toBe('User not found');
    } finally {
      await app.close();
    }
  });
});
