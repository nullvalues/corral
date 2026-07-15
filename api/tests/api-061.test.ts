/**
 * Unit tests for API-061: Verification notification email.
 *
 * Verifies:
 *   - PATCH /api/experiences/:id/verification with action='verify' calls
 *     mailerClient.sendExperienceVerified exactly once with the correct args.
 *   - PATCH /api/experiences/:id/verification with action='unverify' calls
 *     mailerClient.sendExperienceUnverified exactly once.
 *   - A mailer rejection does not change the PATCH response status.
 *   - ConsoleMailerAdapter: both methods resolve and log.
 *
 * Unit project — no DATABASE_URL_TEST required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock refs
// ---------------------------------------------------------------------------

const { verifyExperienceMock, getUserByIdMock } = vi.hoisted(() => ({
  verifyExperienceMock: vi.fn(),
  getUserByIdMock: vi.fn(),
}));

// Mock the experiences service so verifyExperience is controllable.
vi.mock('../src/services/experiences.js', () => ({
  listExperiencesByOwner: vi.fn(),
  getExperienceById: vi.fn(),
  createExperience: vi.fn(),
  updateExperience: vi.fn(),
  deleteExperience: vi.fn(),
  applyPiiGate: vi.fn((e: unknown) => e),
  getRollupByOwner: vi.fn(),
  verifyExperience: verifyExperienceMock,
}));

// Mock users service so getUserById is controllable.
vi.mock('../src/services/users.js', () => ({
  getUserById: getUserByIdMock,
  searchUsersByEmail: vi.fn(),
  listUsers: vi.fn(),
  getUserRoles: vi.fn(),
  setAdminRole: vi.fn(),
}));

// Minimal DB mock to satisfy session-loader and pii-access-log imports.
vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    leftJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    }),
  },
}));

// Mock auth service so session loading is controllable.
vi.mock('../src/services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
  buildAuthConfig: vi.fn().mockReturnValue({ emailAndPassword: {} }),
  setMailer: vi.fn(),
}));

// Mock pii-access-log (fire-and-forget; not under test here).
vi.mock('../src/services/pii-access-log.js', () => ({
  insertPiiAccessLog: vi.fn(),
  listPiiAccessLog: vi.fn(),
}));

// Mock abacPredicates (not needed for these tests — verifyExperience is mocked).
vi.mock('../src/services/auth/abacPredicates.js', () => ({
  isOwner: vi.fn(),
  hasMentorGrant: vi.fn(),
}));

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';
import { ConsoleMailerAdapter } from '../src/lib/mailerAdapters/console.js';
import type { MailerClient } from '../src/lib/mailer.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const MENTOR_ID = 'mentor-user-061';
const OWNER_ID = 'owner-user-061';
const EXP_ID = 'a0000000-0000-4000-8000-000000000061';

const fakeExperience = {
  id: EXP_ID,
  ownerUserId: OWNER_ID,
  categoryId: 'a0000000-0000-4000-8000-0000000000c1',
  organization: 'Verified Corp',
  position: 'Research Assistant',
  frequency: null,
  startDate: new Date('2024-01-01'),
  endDate: null,
  dutiesNarrative: 'Did research.',
  totalHours: 40,
  hoursPerWeek: 8,
  numberOfWeeks: 5,
  stateProvince: null,
  stateProvinceCode: null,
  country: null,
  countryIso2: null,
  countryIso3: null,
  isCurrent: false,
  receivedAcademicCredit: false,
  receivedSalaryOrPayment: false,
  isVolunteer: false,
  isMostImportant: false,
  permissionToContact: false,
  contactTitle: null,
  contactFirstName: null,
  contactLastName: null,
  contactEmail: null,
  contactPhone: null,
  verificationStatus: 'verified',
  verifiedByUserId: MENTOR_ID,
  verifiedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ownerUser = { id: OWNER_ID, email: 'owner@example.com', name: 'Owner User' };
const verifierUser = { id: MENTOR_ID, email: 'mentor@example.com', name: 'Mentor Name' };

function makeSession(userId: string) {
  return {
    user: { id: userId, email: `${userId}@example.com`, name: userId, emailVerified: true, twoFactorEnabled: true, createdAt: new Date(), updatedAt: new Date() },
    session: { id: 'sess-061', userId, expiresAt: new Date(Date.now() + 86400_000), token: 'tok', createdAt: new Date(), updatedAt: new Date(), ipAddress: null, userAgent: null, twoFactorVerified: null },
  };
}

// ---------------------------------------------------------------------------
// Route-level tests: mailer integration
// ---------------------------------------------------------------------------

describe('PATCH /api/experiences/:id/verification — mailer (API-061)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(makeSession(MENTOR_ID) as ReturnType<typeof auth.api.getSession> extends Promise<infer T> ? T : never);
    getUserByIdMock.mockImplementation((id: string) => {
      if (id === OWNER_ID) return Promise.resolve(ownerUser);
      if (id === MENTOR_ID) return Promise.resolve(verifierUser);
      return Promise.resolve(null);
    });
  });

  it('verify action: calls sendExperienceVerified with owner email, org, position, verifierName', async () => {
    const sendExperienceVerified = vi.fn().mockResolvedValue(undefined);
    const sendExperienceUnverified = vi.fn().mockResolvedValue(undefined);
    const mockMailer: MailerClient = {
      sendPasswordReset: vi.fn(),
      sendExperienceVerified,
      sendExperienceUnverified,
    };

    verifyExperienceMock.mockResolvedValue({ ok: true, experience: fakeExperience });

    const app = await buildApp({ mailerClient: mockMailer });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${EXP_ID}/verification`,
        headers: { 'content-type': 'application/json', cookie: 'session=tok' },
        payload: JSON.stringify({ action: 'verify' }),
      });

      expect(res.statusCode).toBe(200);

      // Allow the fire-and-forget promise to settle.
      await new Promise((r) => setTimeout(r, 20));

      expect(sendExperienceVerified).toHaveBeenCalledOnce();
      expect(sendExperienceVerified).toHaveBeenCalledWith({
        to: ownerUser.email,
        experienceOrg: fakeExperience.organization,
        experiencePosition: fakeExperience.position,
        verifierName: verifierUser.name,
      });
      expect(sendExperienceUnverified).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('unverify action: calls sendExperienceUnverified with correct args', async () => {
    const sendExperienceVerified = vi.fn().mockResolvedValue(undefined);
    const sendExperienceUnverified = vi.fn().mockResolvedValue(undefined);
    const mockMailer: MailerClient = {
      sendPasswordReset: vi.fn(),
      sendExperienceVerified,
      sendExperienceUnverified,
    };

    const unverifiedExp = { ...fakeExperience, verificationStatus: 'unverified', verifiedByUserId: null, verifiedAt: null };
    verifyExperienceMock.mockResolvedValue({ ok: true, experience: unverifiedExp });

    const app = await buildApp({ mailerClient: mockMailer });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${EXP_ID}/verification`,
        headers: { 'content-type': 'application/json', cookie: 'session=tok' },
        payload: JSON.stringify({ action: 'unverify' }),
      });

      expect(res.statusCode).toBe(200);

      await new Promise((r) => setTimeout(r, 20));

      expect(sendExperienceUnverified).toHaveBeenCalledOnce();
      expect(sendExperienceUnverified).toHaveBeenCalledWith({
        to: ownerUser.email,
        experienceOrg: fakeExperience.organization,
        experiencePosition: fakeExperience.position,
        verifierName: verifierUser.name,
      });
      expect(sendExperienceVerified).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('mailer rejection does not change the PATCH response status (fire-and-forget)', async () => {
    const mockMailer: MailerClient = {
      sendPasswordReset: vi.fn(),
      sendExperienceVerified: vi.fn().mockRejectedValue(new Error('mailer down')),
      sendExperienceUnverified: vi.fn(),
    };

    verifyExperienceMock.mockResolvedValue({ ok: true, experience: fakeExperience });

    const app = await buildApp({ mailerClient: mockMailer });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${EXP_ID}/verification`,
        headers: { 'content-type': 'application/json', cookie: 'session=tok' },
        payload: JSON.stringify({ action: 'verify' }),
      });

      // Must still be 200 despite the mailer failure.
      expect(res.statusCode).toBe(200);

      // Let the rejected promise settle without crashing.
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      await app.close();
    }
  });

  it('verifyExperience returns ok=false → 403, mailer not called', async () => {
    const sendExperienceVerified = vi.fn();
    const mockMailer: MailerClient = {
      sendPasswordReset: vi.fn(),
      sendExperienceVerified,
      sendExperienceUnverified: vi.fn(),
    };

    verifyExperienceMock.mockResolvedValue({ ok: false, code: 'forbidden' });

    const app = await buildApp({ mailerClient: mockMailer });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experiences/${EXP_ID}/verification`,
        headers: { 'content-type': 'application/json', cookie: 'session=tok' },
        payload: JSON.stringify({ action: 'verify' }),
      });

      expect(res.statusCode).toBe(403);

      await new Promise((r) => setTimeout(r, 20));

      expect(sendExperienceVerified).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// ConsoleMailerAdapter: both new methods resolve and log
// ---------------------------------------------------------------------------

describe('ConsoleMailerAdapter — sendExperienceVerified / sendExperienceUnverified (API-061)', () => {
  it('sendExperienceVerified resolves and logs to stdout', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const adapter = new ConsoleMailerAdapter();
      await expect(
        adapter.sendExperienceVerified({
          to: 'applicant@example.com',
          experienceOrg: 'Acme Corp',
          experiencePosition: 'Intern',
          verifierName: 'Jane Mentor',
        }),
      ).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]?.[0]).toContain('[mailer] sendExperienceVerified');
      expect(spy.mock.calls[0]?.[0]).toContain('applicant@example.com');
    } finally {
      spy.mockRestore();
    }
  });

  it('sendExperienceUnverified resolves and logs to stdout', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const adapter = new ConsoleMailerAdapter();
      await expect(
        adapter.sendExperienceUnverified({
          to: 'applicant@example.com',
          experienceOrg: 'Acme Corp',
          experiencePosition: 'Intern',
          verifierName: 'Jane Mentor',
        }),
      ).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]?.[0]).toContain('[mailer] sendExperienceUnverified');
      expect(spy.mock.calls[0]?.[0]).toContain('applicant@example.com');
    } finally {
      spy.mockRestore();
    }
  });
});
