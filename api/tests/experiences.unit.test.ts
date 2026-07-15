/**
 * Unit tests for updateExperience() verification-reset behaviour (API-048).
 *
 * Unit project — no DATABASE_URL_TEST required. The DB is mocked.
 *
 * Ensures:
 *   - Updating a verified experience always resets verificationStatus to
 *     'unverified', verifiedByUserId to null, and verifiedAt to null.
 *   - Even if the caller's data payload includes verificationStatus: 'verified',
 *     the service-level override wins (stored row ends up 'unverified').
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock — expose the `.set()` call so we can assert its argument.
// ---------------------------------------------------------------------------

const { setMock, returningMock, awardMock } = vi.hoisted(() => ({
  setMock: vi.fn(),
  returningMock: vi.fn(),
  awardMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    update: vi.fn().mockReturnThis(),
    set: setMock,
    where: vi.fn().mockReturnThis(),
    returning: returningMock,
  },
}));

// Mock awardMilestones to avoid its own DB calls.
vi.mock('../src/services/milestones.js', () => ({
  awardMilestones: awardMock,
}));

import { updateExperience } from '../src/services/experiences.js';

// ---------------------------------------------------------------------------
// A minimal fake experience row returned by the DB after update.
// ---------------------------------------------------------------------------
const fakeRow = {
  id: 'exp-1',
  ownerUserId: 'user-1',
  categoryId: 'cat-1',
  organization: 'Org',
  position: 'Pos',
  startDate: new Date('2023-01-01'),
  endDate: null,
  dutiesNarrative: 'Did things.',
  totalHours: 80,
  hoursPerWeek: 8,
  numberOfWeeks: 10,
  frequency: null,
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
  verificationStatus: 'unverified',
  verifiedByUserId: null,
  verifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the update chain terminates and returns the fake row.
  setMock.mockReturnThis();
  returningMock.mockResolvedValue([fakeRow]);
  awardMock.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateExperience — verification reset (API-048)', () => {
  it('resets verificationStatus, verifiedByUserId, and verifiedAt regardless of prior state', async () => {
    await updateExperience('exp-1', { totalHours: 100, hoursPerWeek: 10, numberOfWeeks: 10 });

    expect(setMock).toHaveBeenCalledOnce();
    const setArg = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.verificationStatus).toBe('unverified');
    expect(setArg.verifiedByUserId).toBeNull();
    expect(setArg.verifiedAt).toBeNull();
  });

  it('overrides a caller-supplied verificationStatus: "verified" with "unverified"', async () => {
    // Simulate a caller (internal or future route) passing verification fields.
    await updateExperience('exp-1', {
      // TypeScript won't normally allow this through the route schema, but the
      // service must be the authoritative enforcement point.
      ...(({ verificationStatus: 'verified' } as unknown) as Parameters<typeof updateExperience>[1]),
    });

    expect(setMock).toHaveBeenCalledOnce();
    const setArg = setMock.mock.calls[0][0] as Record<string, unknown>;
    // The service override must win — final value is 'unverified'.
    expect(setArg.verificationStatus).toBe('unverified');
    expect(setArg.verifiedByUserId).toBeNull();
    expect(setArg.verifiedAt).toBeNull();
  });

  it('returns the updated row from the DB', async () => {
    const result = await updateExperience('exp-1', { organization: 'New Org' });
    expect(result).toEqual(fakeRow);
  });

  it('returns null when no row is found (no-op update)', async () => {
    returningMock.mockResolvedValueOnce([]);
    const result = await updateExperience('nonexistent', { organization: 'X' });
    expect(result).toBeNull();
  });
});
