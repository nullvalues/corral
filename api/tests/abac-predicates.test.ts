/**
 * Unit tests for ABAC predicates: isOwner and hasMentorGrant.
 *
 * isOwner is a pure function — no mocks needed.
 * hasMentorGrant requires a mocked DB (same pattern as TEST-003 / rbac-guard.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Declare the limitMock with vi.hoisted() so it is available in the vi.mock
// factory, which is hoisted to the top of the module by Vitest's transformer.
// ---------------------------------------------------------------------------

const { limitMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: limitMock,
  },
}));

import { isOwner, hasMentorGrant } from '../src/services/auth/abacPredicates.js';

// ---------------------------------------------------------------------------
// isOwner — pure function tests (no mocks needed)
// ---------------------------------------------------------------------------

describe('isOwner', () => {
  it('returns true when userId matches resource.ownerId', () => {
    expect(isOwner('user-1', { ownerId: 'user-1' })).toBe(true);
  });

  it('returns false when userId differs from resource.ownerId', () => {
    expect(isOwner('user-1', { ownerId: 'user-2' })).toBe(false);
  });

  it('returns false when userId is an empty string', () => {
    expect(isOwner('', { ownerId: 'user-1' })).toBe(false);
  });

  it('returns false when ownerId is an empty string', () => {
    expect(isOwner('user-1', { ownerId: '' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasMentorGrant — DB-backed tests (DB mock required)
// ---------------------------------------------------------------------------

describe('hasMentorGrant', () => {
  beforeEach(() => {
    limitMock.mockReset();
  });

  it('returns true when an active grant exists with the requested permission in the array', async () => {
    limitMock.mockResolvedValueOnce([{ permissions: ['view-profile', 'edit-cv'] }]);

    const result = await hasMentorGrant('mentor-1', 'applicant-1', 'view-profile');

    expect(result).toBe(true);
  });

  it('returns false when no matching grant row exists', async () => {
    limitMock.mockResolvedValueOnce([]);

    const result = await hasMentorGrant('mentor-1', 'applicant-1', 'view-profile');

    expect(result).toBe(false);
  });

  it('returns false when the grant exists but status is revoked (no row returned due to active filter)', async () => {
    // The DB query filters on status = 'active', so a revoked grant returns no rows
    limitMock.mockResolvedValueOnce([]);

    const result = await hasMentorGrant('mentor-1', 'applicant-1', 'view-profile');

    expect(result).toBe(false);
  });

  it('returns false when the grant is active but the permissions array does not contain the requested permission', async () => {
    limitMock.mockResolvedValueOnce([{ permissions: ['view-profile'] }]);

    const result = await hasMentorGrant('mentor-1', 'applicant-1', 'edit-cv');

    expect(result).toBe(false);
  });
});
