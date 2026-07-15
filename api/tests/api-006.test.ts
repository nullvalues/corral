/**
 * Unit tests for POST/PATCH/DELETE /api/experience-categories (API-006).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests inject without a session
 * (→ 401) and with a non-admin session (→ 403). The DB is mocked so no live
 * connection is needed.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports. The select chain must return an empty
// array for the requireRole preHandler (no role grant → 403).
// The auth module must return null by default (no session → 401).
// ---------------------------------------------------------------------------

const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: limitMock,
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
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

const VALID_SLUG_BODY = JSON.stringify({ slug: 'test-category', name: 'Test Category' });
const VALID_PATCH_BODY = JSON.stringify({ name: 'Updated Name' });
const VALID_UUID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/experience-categories — unit', () => {
  it('returns 401 when no session is provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/experience-categories',
        headers: { 'content-type': 'application/json' },
        payload: VALID_SLUG_BODY,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    const fakeUser = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'user-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    // No role grant returned → 403
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/experience-categories',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_SLUG_BODY,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe('PATCH /api/experience-categories/:id — unit', () => {
  it('returns 401 when no session is provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { 'content-type': 'application/json' },
        payload: VALID_PATCH_BODY,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    const fakeUser = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'user-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_PATCH_BODY,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /api/experience-categories/:id — unit', () => {
  it('returns 401 when no session is provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experience-categories/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when authenticated user lacks admin role', async () => {
    const fakeUser = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'user-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
