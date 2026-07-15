/**
 * Unit tests for GET /api/experiences/export (API-062).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests verify:
 *   - Unauthenticated request → 401 (requireAuth preHandler).
 *   - /experiences/export is NOT shadowed by /experiences/:id — the request
 *     reaches the export handler (proven by the 401 path being the export
 *     route's auth gate, and by the route table registration order).
 */

import { describe, it, expect, vi } from 'vitest';

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

describe('GET /api/experiences/export — unit', () => {
  it('returns 401 when no session cookie is provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/experiences/export?owner_user_id=user-123',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('does not shadow /export behind /:id — /export is a registered static route', async () => {
    const app = await buildApp();
    try {
      // If /export were shadowed by /experiences/:id, the :id param route's
      // uuid param schema would reject "export" with a 400 validation error.
      // A 401 (auth gate) proves the request reached the export handler.
      vi.mocked(auth.api.getSession).mockResolvedValue(null);
      const res = await app.inject({
        method: 'GET',
        url: '/api/experiences/export',
      });
      expect(res.statusCode).toBe(401);
      expect(res.statusCode).not.toBe(400);
    } finally {
      await app.close();
    }
  });
});
