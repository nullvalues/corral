/**
 * Unit tests for PATCH/DELETE /api/experiences/:id (API-010).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests verify:
 *   - Unauthenticated PATCH → 401
 *   - Unauthenticated DELETE → 401
 *   - Invalid UUID param in PATCH → 400
 *   - Invalid UUID param in DELETE → 400
 *
 * NOTE on param validation + Fastify hook ordering: Fastify runs preValidation
 * (param validation) BEFORE preHandler (session loading). An invalid-UUID
 * request never reaches sessionLoader, so a mockResolvedValueOnce set before
 * such a request is NOT consumed. Tests are ordered and mock state is managed
 * explicitly to prevent state leakage across describe blocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports.
// ---------------------------------------------------------------------------

const { limitMock, whereMock, returningMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  whereMock: vi.fn(),
  returningMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: whereMock,
    limit: limitMock,
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: returningMock,
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

const validUuid = '550e8400-e29b-41d4-a716-446655440000';
const notAUuid = 'not-a-uuid';

// Reset mock call state before each test to avoid leaking mockResolvedValueOnce
// calls across tests when param validation short-circuits before session loading.
beforeEach(async () => {
  const { auth } = await import('../src/services/auth/index.js');
  vi.mocked(auth.api.getSession).mockReset();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
  limitMock.mockReset();
  whereMock.mockReset();
  returningMock.mockReset();
});

function fakeSession(id = 'user-1') {
  return {
    user: {
      id,
      name: 'Test',
      email: 'test@example.com',
      twoFactorEnabled: true,
      createdAt: new Date().toISOString(),
    } as never,
    session: { id: 'sess-1', userId: id, token: 'tok' } as never,
  };
}

// ---------------------------------------------------------------------------
// PATCH tests
// ---------------------------------------------------------------------------

describe('PATCH /api/experiences/:id — unit', () => {
  it('returns 401 when no session cookie is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${validUuid}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ organization: 'Updated Org' }),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when :id is not a valid UUID', async () => {
    const { auth } = await import('../src/services/auth/index.js');
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(fakeSession());
    whereMock.mockReturnThis();
    limitMock.mockResolvedValue([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${notAUuid}`,
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ organization: 'Updated Org' }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE tests
// ---------------------------------------------------------------------------

describe('DELETE /api/experiences/:id — unit', () => {
  it('returns 401 when no session cookie is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experiences/${validUuid}`,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when :id is not a valid UUID', async () => {
    const { auth } = await import('../src/services/auth/index.js');
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(fakeSession());
    whereMock.mockReturnThis();
    limitMock.mockResolvedValue([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experiences/${notAUuid}`,
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
