/**
 * Unit tests for POST /api/experiences (API-009).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests verify:
 *   - Unauthenticated request → 401 (handled by protectedScope session gate)
 *   - Hours-triple mismatch (totalHours !== hoursPerWeek × numberOfWeeks) → 400
 *   - Invalid phone format → 400
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before app imports.
// The auth module returns null by default (no session → 401).
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
import { auth } from '../src/services/auth/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid body that satisfies the hours-triple: 40 = 8 * 5 */
const validBody = {
  categoryId: '550e8400-e29b-41d4-a716-446655440000',
  organization: 'Test Org',
  position: 'Test Position',
  startDate: '2023-01-01',
  dutiesNarrative: 'Did some work.',
  totalHours: 40,
  hoursPerWeek: 8,
  numberOfWeeks: 5,
};

function fakeSession(id = 'user-1') {
  return {
    user: { id, name: 'Alice', email: 'alice@example.com' } as never,
    session: { id: 'sess-1', userId: id, token: 'tok' } as never,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/experiences — unit', () => {
  it('returns 401 when no session cookie is provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(validBody),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when totalHours does not equal hoursPerWeek × numberOfWeeks', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(fakeSession());
    limitMock.mockResolvedValue([]);
    whereMock.mockReturnThis();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({
          ...validBody,
          totalHours: 99, // 8 * 5 = 40, not 99
        }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when contactPhone is provided with an invalid format', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(fakeSession());
    limitMock.mockResolvedValue([]);
    whereMock.mockReturnThis();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/experiences',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({
          ...validBody,
          contactPhone: '5551234567', // missing leading '+'
        }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
