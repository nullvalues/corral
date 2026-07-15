/**
 * Unit tests for requireAuth() preHandler factory (API-054).
 *
 * Tests:
 *   - requireAuth() returns 401 with { error: 'Unauthorized' } when request.user is null
 *   - An authenticated request passes through the preHandler without emitting a 401
 *   - The guard is active on ABAC-only routes (e.g. GET /api/me and GET /api/mentor/impact)
 *
 * No DATABASE_URL_TEST required — DB is mocked.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB and auth before any app import so the unit project does not need a
// live connection.
// ---------------------------------------------------------------------------

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => ({
      then: (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve([]).catch(reject),
      limit: vi.fn().mockResolvedValue([]),
    })),
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

// Also mock services that touch the DB so the unit project does not need a live connection
vi.mock('../src/services/mentor-impact.js', () => ({
  getMentorImpact: vi.fn().mockResolvedValue({
    monthHoursVerified: 0,
    lifetimeHoursVerified: 0,
    applicantsMentored: 0,
    avgTurnaroundHours: null,
    streakDays: 0,
    pendingVerifications: 0,
  }),
}));

vi.mock('../src/services/talent-pool.js', () => ({
  listTalentPool: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/milestones.js', () => ({
  getMyMilestones: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/me.js', () => ({
  getMyRoles: vi.fn().mockResolvedValue([]),
  getHasActiveMentorGrants: vi.fn().mockResolvedValue(false),
}));

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAuthenticatedSession() {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: {
      id: 'user-test-1',
      name: 'Test User',
      email: 'test@example.com',
      twoFactorEnabled: true,
    } as never,
    session: { id: 'sess-1', userId: 'user-test-1', token: 'tok' } as never,
  });
}

// ---------------------------------------------------------------------------
// Tests for requireAuth() preHandler behaviour
// ---------------------------------------------------------------------------

describe('requireAuth() preHandler — unit', () => {
  it('returns 401 with { error: "Unauthorized" } on GET /api/me when unauthenticated', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/me' });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    } finally {
      await app.close();
    }
  });

  it('passes through to handler on GET /api/me when authenticated', async () => {
    mockAuthenticatedSession();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: 'session=fake' },
      });
      // Authenticated — should reach the handler and return 200
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('returns 401 with { error: "Unauthorized" } on GET /api/me/milestones when unauthenticated', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/me/milestones' });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    } finally {
      await app.close();
    }
  });

  it('passes through to handler on GET /api/me/milestones when authenticated', async () => {
    mockAuthenticatedSession();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me/milestones',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('returns 401 with { error: "Unauthorized" } on GET /api/mentor/impact when unauthenticated', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/mentor/impact' });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    } finally {
      await app.close();
    }
  });

  it('passes through to handler on GET /api/mentor/impact when authenticated', async () => {
    mockAuthenticatedSession();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/impact',
        headers: { cookie: 'session=fake' },
      });
      // Authenticated — handler reached (200 with mocked impact data)
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('returns 401 with { error: "Unauthorized" } on GET /api/mentor-grants/mine when unauthenticated', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/mentor-grants/mine' });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    } finally {
      await app.close();
    }
  });
});
