/**
 * Unit tests for GET /api/experiences/:id (API-008).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests verify:
 *   - Unauthenticated request → 401 (handled by protectedScope session gate)
 *   - Invalid UUID in path param → 400 (Zod params validation)
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports. The select chain needs to handle both
// the session-loader query (system_roles / mentor_grants) and the experiences query.
// The auth module returns null by default (no session → 401).
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
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/experiences/:id — unit', () => {
  it('returns 401 when no session cookie is provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/experiences/550e8400-e29b-41d4-a716-446655440000',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when path param is not a valid UUID', async () => {
    // Provide a valid session so the request gets past the session gate
    const fakeUser = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'user-1', token: 'tok' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    // Return empty for the system_roles lookup (TOTP check in mfaGate)
    limitMock.mockResolvedValue([]);
    whereMock.mockReturnThis();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/experiences/not-a-uuid',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
