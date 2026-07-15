/**
 * Unit tests for GET /api/readiness-config and PUT /api/admin/readiness-config.
 *
 * Covers:
 *   API-052 — weight sum validation (PUT)
 *   API-063 — platinumHours field validation (PUT; invalid values rejected)
 *
 * Unit project — no DATABASE_URL_TEST required.
 *
 * Note: GET returning platinumHours and admin/non-admin PUT gate are covered
 * by api-042.integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB module before app imports.
// ---------------------------------------------------------------------------

const { limitMock, upsertMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: limitMock,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: upsertMock,
        }),
        returning: vi.fn().mockResolvedValue([]),
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

const ADMIN_USER_ID = 'admin-user-rc';

function mockAdminSession() {
  const fakeUser = { id: ADMIN_USER_ID, name: 'Admin', email: 'admin@example.com', twoFactorEnabled: true };
  const fakeSession = { id: 'sess-admin', userId: ADMIN_USER_ID, token: 'tok-admin' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
  // Admin role row
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

describe('PUT /api/admin/readiness-config — weight sum validation (API-052)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    upsertMock.mockResolvedValue([]);
  });

  it('returns 400 when weights sum to 0.9 (not 1.0)', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ wGoal: 0.6, wVerified: 0.2, wBreadth: 0.1, platinumHours: 1000 }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 200 when weights sum to exactly 1.0', async () => {
    mockAdminSession();

    const updatedConfig = { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000 };
    upsertMock.mockResolvedValueOnce([updatedConfig]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify(updatedConfig),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as typeof updatedConfig;
      expect(body.wGoal).toBe(0.6);
      expect(body.wVerified).toBe(0.25);
      expect(body.wBreadth).toBe(0.15);
      expect(body.platinumHours).toBe(1000);
    } finally {
      await app.close();
    }
  });

  it('returns 200 when weights sum within 0.001 tolerance (0.3334 + 0.3333 + 0.3333)', async () => {
    mockAdminSession();

    const updatedConfig = { wGoal: 0.3334, wVerified: 0.3333, wBreadth: 0.3333, platinumHours: 1000 };
    upsertMock.mockResolvedValueOnce([updatedConfig]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify(updatedConfig),
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe('PUT /api/admin/readiness-config — platinumHours validation (API-063)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    upsertMock.mockResolvedValue([]);
  });

  it('returns 400 for platinumHours = 0', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 0 }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 for negative platinumHours', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: -100 }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 for non-integer platinumHours', async () => {
    mockAdminSession();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000.5 }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 200 and updates platinumHours when value is a valid positive integer', async () => {
    mockAdminSession();

    const updatedConfig = { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 500 };
    upsertMock.mockResolvedValueOnce([updatedConfig]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/readiness-config',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify(updatedConfig),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as typeof updatedConfig;
      expect(body.platinumHours).toBe(500);
    } finally {
      await app.close();
    }
  });
});
