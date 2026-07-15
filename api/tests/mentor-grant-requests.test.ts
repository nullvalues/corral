/**
 * Unit tests for POST /api/mentor-grants/requests (API-031 / API-050).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests exercise:
 *   - 401 when unauthenticated
 *   - 403 when caller is an admin (denyRole('admin'))
 *   - 201 { message: 'Request sent' } for not-found mentor (anti-enumeration)
 *   - 201 { message: 'Request sent' } for duplicate grant (anti-enumeration)
 *   - 201 { message: 'Request sent' } on success
 *
 * Anti-enumeration: the route returns 201 unconditionally so callers cannot
 * use the HTTP status to discover whether an email is registered or a grant
 * already exists. The actual outcome is logged server-side only.
 *
 * requestMentorGrant service:
 *   - returns { error: 'not_found' } when email not found
 *   - returns { error: 'conflict' } when duplicate exists
 *   - returns { grant } on success
 *
 * The DB is mocked so no live connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { limitMock, returningMock, orderByMock, innerJoinWhereMock, selectFromWhereLimitMock } =
  vi.hoisted(() => ({
    limitMock: vi.fn(),
    returningMock: vi.fn(),
    orderByMock: vi.fn(),
    innerJoinWhereMock: vi.fn(),
    // Separate mock for the sequential .select().from().where().limit() calls
    // inside requestMentorGrant (user lookup, then duplicate-check lookup)
    selectFromWhereLimitMock: vi.fn(),
  }));

// Track call count within a request so we can return different values
// for the first vs second .limit() call in requestMentorGrant.
let limitCallCount = 0;

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: (...args: unknown[]) => limitMock(...args),
    orderBy: orderByMock,
    innerJoin: vi.fn().mockReturnValue({ where: innerJoinWhereMock }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        catch: vi.fn(),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
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
import { requestMentorGrant } from '../src/services/mentor-grants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APPLICANT_USER_ID = 'applicant-user-1';
const MENTOR_USER_ID = 'mentor-user-2';
const ADMIN_USER_ID = 'admin-user-3';
const MENTOR_EMAIL = 'mentor@example.com';

const VALID_BODY = JSON.stringify({ mentorEmail: MENTOR_EMAIL });

function mockApplicantSession() {
  const fakeUser = {
    id: APPLICANT_USER_ID,
    name: 'Alice',
    email: 'alice@example.com',
    twoFactorEnabled: true,
  };
  const fakeSession = { id: 'sess-applicant', userId: APPLICANT_USER_ID, token: 'tok-applicant' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
}

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
}

// ---------------------------------------------------------------------------
// Service unit tests
// ---------------------------------------------------------------------------

describe('requestMentorGrant — service unit', () => {
  beforeEach(() => {
    limitMock.mockReset();
    returningMock.mockReset();
  });

  it('returns { error: "not_found" } when no user matches the email', async () => {
    // First limit() call = user lookup → empty
    limitMock.mockResolvedValueOnce([]);

    const result = await requestMentorGrant(APPLICANT_USER_ID, MENTOR_EMAIL);
    expect(result).toEqual({ error: 'not_found' });
  });

  it('returns { error: "conflict" } when a pending grant already exists', async () => {
    // First limit() = user lookup → found
    limitMock.mockResolvedValueOnce([{ id: MENTOR_USER_ID, email: MENTOR_EMAIL }]);
    // Second limit() = duplicate check → found
    limitMock.mockResolvedValueOnce([{ id: 'existing-grant-id' }]);

    const result = await requestMentorGrant(APPLICANT_USER_ID, MENTOR_EMAIL);
    expect(result).toEqual({ error: 'conflict' });
  });

  it('returns { grant } when no duplicate exists', async () => {
    const fakeGrant = {
      id: 'new-grant-id',
      applicantUserId: APPLICANT_USER_ID,
      mentorUserId: MENTOR_USER_ID,
      permissions: [],
      grantedByUserId: APPLICANT_USER_ID,
      grantedAt: new Date('2026-06-24T00:00:00.000Z'),
      status: 'pending',
      requestedByUserId: APPLICANT_USER_ID,
    };

    // First limit() = user lookup → found
    limitMock.mockResolvedValueOnce([{ id: MENTOR_USER_ID, email: MENTOR_EMAIL }]);
    // Second limit() = duplicate check → empty
    limitMock.mockResolvedValueOnce([]);
    // returning() = insert result
    returningMock.mockResolvedValueOnce([fakeGrant]);

    const result = await requestMentorGrant(APPLICANT_USER_ID, MENTOR_EMAIL);
    expect(result).toEqual({ grant: fakeGrant });
  });
});

// ---------------------------------------------------------------------------
// Route unit tests
// ---------------------------------------------------------------------------

describe('POST /api/mentor-grants/requests — unit', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockReset();
    limitMock.mockResolvedValue([]);
    returningMock.mockReset();
    returningMock.mockResolvedValue([]);
    orderByMock.mockReset();
    orderByMock.mockResolvedValue([]);
    innerJoinWhereMock.mockReset();
    innerJoinWhereMock.mockResolvedValue([]);
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when caller is an admin', async () => {
    mockAdminSession();
    // requireRole('applicant') check — admin has applicant role too
    limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'applicant' }]);
    // denyRole('admin') check — admin has admin role → deny
    limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 201 { message: "Request sent" } when mentor email is not found (anti-enumeration)', async () => {
    mockApplicantSession();
    // requireRole('applicant') → found
    limitMock.mockResolvedValueOnce([{ userId: APPLICANT_USER_ID, role: 'applicant' }]);
    // denyRole('admin') → not admin, so empty
    limitMock.mockResolvedValueOnce([]);
    // requestMentorGrant: user lookup → not found
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { message: string };
      expect(body.message).toBe('Request sent');
    } finally {
      await app.close();
    }
  });

  it('returns 201 { message: "Request sent" } when a duplicate pending/active grant exists (anti-enumeration)', async () => {
    mockApplicantSession();
    // requireRole('applicant') → found
    limitMock.mockResolvedValueOnce([{ userId: APPLICANT_USER_ID, role: 'applicant' }]);
    // denyRole('admin') → not admin
    limitMock.mockResolvedValueOnce([]);
    // requestMentorGrant: user lookup → found
    limitMock.mockResolvedValueOnce([{ id: MENTOR_USER_ID, email: MENTOR_EMAIL }]);
    // requestMentorGrant: duplicate check → found
    limitMock.mockResolvedValueOnce([{ id: 'existing-grant' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { message: string };
      expect(body.message).toBe('Request sent');
    } finally {
      await app.close();
    }
  });

  it('returns 201 { message: "Request sent" } when applicant posts valid body', async () => {
    const fakeGrant = {
      id: 'new-grant-id',
      applicantUserId: APPLICANT_USER_ID,
      mentorUserId: MENTOR_USER_ID,
      permissions: [],
      grantedByUserId: APPLICANT_USER_ID,
      grantedAt: new Date('2026-06-24T00:00:00.000Z'),
      status: 'pending',
      requestedByUserId: APPLICANT_USER_ID,
    };

    mockApplicantSession();
    // requireRole('applicant') → found
    limitMock.mockResolvedValueOnce([{ userId: APPLICANT_USER_ID, role: 'applicant' }]);
    // denyRole('admin') → not admin
    limitMock.mockResolvedValueOnce([]);
    // requestMentorGrant: user lookup → found
    limitMock.mockResolvedValueOnce([{ id: MENTOR_USER_ID, email: MENTOR_EMAIL }]);
    // requestMentorGrant: duplicate check → not found
    limitMock.mockResolvedValueOnce([]);
    // requestMentorGrant: insert returning
    returningMock.mockResolvedValueOnce([fakeGrant]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { message: string };
      expect(body.message).toBe('Request sent');
    } finally {
      await app.close();
    }
  });

  it('three outcomes (not_found, conflict, success) all return byte-identical status and body', async () => {
    // not_found scenario
    mockApplicantSession();
    limitMock.mockResolvedValueOnce([{ userId: APPLICANT_USER_ID, role: 'applicant' }]);
    limitMock.mockResolvedValueOnce([]);
    limitMock.mockResolvedValueOnce([]); // user not found
    const app1 = await buildApp();
    let res1: Awaited<ReturnType<typeof app1.inject>>;
    try {
      res1 = await app1.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
    } finally {
      await app1.close();
    }

    // conflict scenario
    mockApplicantSession();
    limitMock.mockResolvedValueOnce([{ userId: APPLICANT_USER_ID, role: 'applicant' }]);
    limitMock.mockResolvedValueOnce([]);
    limitMock.mockResolvedValueOnce([{ id: MENTOR_USER_ID }]); // user found
    limitMock.mockResolvedValueOnce([{ id: 'existing-grant' }]); // conflict
    const app2 = await buildApp();
    let res2: Awaited<ReturnType<typeof app2.inject>>;
    try {
      res2 = await app2.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
    } finally {
      await app2.close();
    }

    // success scenario
    const fakeGrant = {
      id: 'new-grant-id',
      applicantUserId: APPLICANT_USER_ID,
      mentorUserId: MENTOR_USER_ID,
      permissions: [],
      grantedByUserId: APPLICANT_USER_ID,
      grantedAt: new Date('2026-06-24T00:00:00.000Z'),
      status: 'pending',
      requestedByUserId: APPLICANT_USER_ID,
    };
    mockApplicantSession();
    limitMock.mockResolvedValueOnce([{ userId: APPLICANT_USER_ID, role: 'applicant' }]);
    limitMock.mockResolvedValueOnce([]);
    limitMock.mockResolvedValueOnce([{ id: MENTOR_USER_ID }]); // user found
    limitMock.mockResolvedValueOnce([]); // no conflict
    returningMock.mockResolvedValueOnce([fakeGrant]);
    const app3 = await buildApp();
    let res3: Awaited<ReturnType<typeof app3.inject>>;
    try {
      res3 = await app3.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: VALID_BODY,
      });
    } finally {
      await app3.close();
    }

    // All three must be byte-identical
    expect(res1!.statusCode).toBe(201);
    expect(res2!.statusCode).toBe(201);
    expect(res3!.statusCode).toBe(201);
    expect(res1!.body).toBe(res2!.body);
    expect(res2!.body).toBe(res3!.body);
  });

  it('returns 400 when mentorEmail is not a valid email', async () => {
    mockApplicantSession();
    // requireRole('applicant') → found (Zod validation runs after preHandlers but before handler)
    // Actually Zod body validation runs before handler so we may not even get to requireRole
    // but to be safe: provide the role mock anyway
    limitMock.mockResolvedValueOnce([{ userId: APPLICANT_USER_ID, role: 'applicant' }]);
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants/requests',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ mentorEmail: 'not-an-email' }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
