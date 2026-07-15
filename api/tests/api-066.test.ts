/**
 * Unit tests for API-066 — URL scheme validation on PATCH /api/me/profile.
 *
 * Verifies that linkedinUrl and portfolioUrl reject javascript: and data: scheme
 * values with a 400 status, and accept valid https:// URLs.
 *
 * The Zod refinement in PatchProfileBody fires before any service / DB call, so
 * the DB is mocked with a minimal stub that never needs to be called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks before any imports that load the real modules.
// ---------------------------------------------------------------------------

const { whereMock, limitMock } = vi.hoisted(() => ({
  whereMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: whereMock,
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
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

// Mock the profile service so we never need a live DB select on success paths.
vi.mock('../src/services/profile.js', () => ({
  getMyProfile: vi.fn().mockResolvedValue(null),
  updateMyProfile: vi.fn().mockResolvedValue({
    name: 'Test User',
    email: 'test@example.com',
    school: null,
    graduationYear: null,
    bio: null,
    major: null,
    gpa: null,
    phone: null,
    linkedinUrl: 'https://linkedin.com/in/test',
    portfolioUrl: null,
  }),
  getApplicantProfileForMentor: vi.fn().mockResolvedValue(null),
}));

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-api066-1';

function mockSession() {
  const fakeUser = {
    id: USER_ID,
    name: 'Test User',
    email: 'test@example.com',
    twoFactorEnabled: true,
  };
  const fakeSession = { id: 'sess-066', userId: USER_ID, token: 'tok-066' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
}

/**
 * requireRole('applicant') calls getMyRoles (db.select().from().where() — awaited
 * directly) to check system_roles. Return an applicant role row so the guard passes.
 */
function mockDbForRoleCheck() {
  whereMock.mockImplementationOnce(() => ({
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve([{ role: 'applicant' }]).then(resolve),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve([{ role: 'applicant' }]).catch(reject),
    limit: limitMock.mockResolvedValueOnce([{ role: 'applicant' }]),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/me/profile — URL scheme validation (API-066)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    whereMock.mockReset();
    limitMock.mockReset();
    // Default fallback: empty result for any un-mocked where() call
    whereMock.mockImplementation(() => ({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve([]).then(resolve),
      catch: (reject: (e: unknown) => unknown) =>
        Promise.resolve([]).catch(reject),
      limit: limitMock.mockResolvedValue([]),
    }));
  });

  it('returns 400 when linkedinUrl has a javascript: scheme', async () => {
    mockSession();
    mockDbForRoleCheck();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me/profile',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ linkedinUrl: 'javascript:alert(1)' }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when portfolioUrl has a data: scheme', async () => {
    mockSession();
    mockDbForRoleCheck();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me/profile',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ portfolioUrl: 'data:text/html,<script>x</script>' }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 200 when linkedinUrl has a valid https:// URL', async () => {
    mockSession();
    mockDbForRoleCheck();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me/profile',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ linkedinUrl: 'https://linkedin.com/in/test' }),
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when linkedinUrl has a vbscript: scheme', async () => {
    mockSession();
    mockDbForRoleCheck();

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me/profile',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ linkedinUrl: 'vbscript:msgbox(1)' }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
