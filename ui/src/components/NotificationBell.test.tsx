/**
 * NotificationBell tests — UI-105
 *
 * Covers:
 *  1. Badge shows count when mocked experiences include a verified item newer
 *     than the stored ack timestamp.
 *  2. No badge when all verified experiences predate the stored ack timestamp.
 *  3. Opening the dropdown lists verified experiences (max 10).
 *  4. "Mark all read" writes ack timestamp to localStorage and clears the badge.
 *  5. localStorage key includes the user id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NotificationBell } from './NotificationBell.js';

// ── hook mocks ────────────────────────────────────────────────────────────────

vi.mock('../hooks/useCurrentUserId.js', () => ({
  useCurrentUserId: vi.fn(),
}));

vi.mock('../hooks/useExperiences.js', () => ({
  useExperiences: vi.fn(),
}));

import { useCurrentUserId } from '../hooks/useCurrentUserId.js';
import { useExperiences } from '../hooks/useExperiences.js';

const mockUseCurrentUserId = useCurrentUserId as ReturnType<typeof vi.fn>;
const mockUseExperiences = useExperiences as ReturnType<typeof vi.fn>;

// ── test helpers ──────────────────────────────────────────────────────────────

const UID = 'user-abc-123';
const ACK_KEY = `asp:notifications:ack:${UID}`;

/** A verified experience with a timestamp well after any stored ack. */
function makeVerifiedExp(
  id: string,
  organization = 'Hospital A',
  position = 'Volunteer',
  verifiedAt = '2026-06-01T10:00:00.000Z',
) {
  return {
    id,
    organization,
    position,
    verificationStatus: 'verified' as const,
    verifiedAt,
    updatedAt: verifiedAt,
  };
}

/** An unverified experience — should never appear in notifications. */
function makeUnverifiedExp(id: string) {
  return {
    id,
    organization: 'Clinic B',
    position: 'Observer',
    verificationStatus: 'unverified' as const,
    verifiedAt: null,
    updatedAt: '2026-05-01T08:00:00.000Z',
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Default mock returns: logged-in user + empty experience list
  mockUseCurrentUserId.mockReturnValue(UID);
  mockUseExperiences.mockReturnValue({ data: [] });
});

afterEach(() => {
  cleanup();
});

// ── suite 1: badge visibility ─────────────────────────────────────────────────

describe('NotificationBell — badge', () => {
  it('shows a badge count when there is a verified experience newer than the stored ack', () => {
    // No ack stored → everything verified counts as a notification
    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1'), makeUnverifiedExp('exp-2')],
    });

    render(<NotificationBell />);

    const badge = screen.getByTestId('notification-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('1');
  });

  it('hides the badge when all verified experiences predate the stored ack timestamp', () => {
    const ackTime = '2026-07-01T00:00:00.000Z';
    localStorage.setItem(ACK_KEY, ackTime);

    // Experience was verified BEFORE the ack timestamp
    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1', 'Hospital', 'Volunteer', '2026-05-01T00:00:00.000Z')],
    });

    render(<NotificationBell />);

    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('shows no badge when there are no verified experiences at all', () => {
    mockUseExperiences.mockReturnValue({ data: [makeUnverifiedExp('exp-1')] });

    render(<NotificationBell />);

    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('shows the badge count for multiple new verified experiences', () => {
    mockUseExperiences.mockReturnValue({
      data: [
        makeVerifiedExp('exp-1'),
        makeVerifiedExp('exp-2'),
        makeVerifiedExp('exp-3'),
      ],
    });

    render(<NotificationBell />);

    const badge = screen.getByTestId('notification-badge');
    expect(badge.textContent).toBe('3');
  });

  it('caps the badge display at "9+" when more than 9 notifications exist', () => {
    const exps = Array.from({ length: 12 }, (_, i) =>
      makeVerifiedExp(`exp-${i}`, `Org ${i}`, `Role ${i}`),
    );
    mockUseExperiences.mockReturnValue({ data: exps });

    render(<NotificationBell />);

    const badge = screen.getByTestId('notification-badge');
    expect(badge.textContent).toBe('9+');
  });
});

// ── suite 2: dropdown contents ────────────────────────────────────────────────

describe('NotificationBell — dropdown', () => {
  it('opens the dropdown when the bell is clicked', () => {
    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1')],
    });

    render(<NotificationBell />);

    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('notification-bell'));

    expect(screen.getByTestId('notification-dropdown')).toBeInTheDocument();
  });

  it('lists verified experiences in the dropdown (max 10)', () => {
    // 12 verified experiences — only 10 should appear in dropdown
    const exps = Array.from({ length: 12 }, (_, i) =>
      makeVerifiedExp(`exp-${i}`, `Org ${i}`, `Role ${i}`),
    );
    mockUseExperiences.mockReturnValue({ data: exps });

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('notification-bell'));

    const items = screen.getAllByTestId('notification-item');
    expect(items).toHaveLength(10);
  });

  it('shows organization and position text in each notification item', () => {
    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1', 'Children\'s Hospital', 'Clinical Volunteer')],
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('notification-bell'));

    expect(screen.getByText("Children's Hospital")).toBeInTheDocument();
    expect(screen.getByText('Clinical Volunteer')).toBeInTheDocument();
  });

  it('shows the empty state message when there are no new notifications', () => {
    // No experiences at all
    mockUseExperiences.mockReturnValue({ data: [] });

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('notification-bell'));

    expect(screen.getByText('No new notifications.')).toBeInTheDocument();
  });

  it('does not show unverified experiences in the dropdown', () => {
    mockUseExperiences.mockReturnValue({
      data: [makeUnverifiedExp('exp-1')],
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('notification-bell'));

    expect(screen.queryByTestId('notification-item')).not.toBeInTheDocument();
    expect(screen.getByText('No new notifications.')).toBeInTheDocument();
  });
});

// ── suite 3: mark all read ────────────────────────────────────────────────────

describe('NotificationBell — mark all read', () => {
  it('"Mark all read" clears the badge', () => {
    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1')],
    });

    render(<NotificationBell />);

    // Badge is visible
    expect(screen.getByTestId('notification-badge')).toBeInTheDocument();

    // Open and click mark all read
    fireEvent.click(screen.getByTestId('notification-bell'));
    fireEvent.click(screen.getByTestId('mark-all-read'));

    // Badge should be gone
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('"Mark all read" writes an ISO ack timestamp to localStorage', () => {
    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1')],
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('notification-bell'));
    fireEvent.click(screen.getByTestId('mark-all-read'));

    const stored = localStorage.getItem(ACK_KEY);
    expect(stored).not.toBeNull();
    // Must be a valid ISO timestamp
    expect(new Date(stored!).getTime()).not.toBeNaN();
  });

  it('"Mark all read" closes the dropdown', () => {
    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1')],
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('notification-bell'));
    expect(screen.getByTestId('notification-dropdown')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mark-all-read'));
    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument();
  });
});

// ── suite 4: per-user key isolation ──────────────────────────────────────────

describe('NotificationBell — localStorage key includes user id', () => {
  it('uses the userId in the localStorage key', () => {
    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1')],
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('notification-bell'));
    fireEvent.click(screen.getByTestId('mark-all-read'));

    const keyUsed = `asp:notifications:ack:${UID}`;
    expect(localStorage.getItem(keyUsed)).not.toBeNull();
  });

  it('reads the ack from the correct per-user key on mount', () => {
    // Pre-populate the ack for this user — everything will predate it
    const ackTime = '2026-07-01T00:00:00.000Z';
    localStorage.setItem(ACK_KEY, ackTime);

    mockUseExperiences.mockReturnValue({
      data: [makeVerifiedExp('exp-1', 'Org', 'Role', '2026-06-01T00:00:00.000Z')],
    });

    render(<NotificationBell />);

    // No badge — ack covers all experiences
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('uses verifiedAt as the effective timestamp when present', () => {
    // verifiedAt is after the ack, updatedAt is before — should still notify
    const ackTime = '2026-06-01T00:00:00.000Z';
    localStorage.setItem(ACK_KEY, ackTime);

    mockUseExperiences.mockReturnValue({
      data: [
        {
          id: 'exp-1',
          organization: 'Hospital',
          position: 'Volunteer',
          verificationStatus: 'verified' as const,
          verifiedAt: '2026-07-01T00:00:00.000Z',  // after ack
          updatedAt: '2026-05-01T00:00:00.000Z',    // before ack (should not matter)
        },
      ],
    });

    render(<NotificationBell />);
    expect(screen.getByTestId('notification-badge')).toBeInTheDocument();
  });

  it('falls back to updatedAt when verifiedAt is null', () => {
    // No ack → updatedAt used as timestamp
    mockUseExperiences.mockReturnValue({
      data: [
        {
          id: 'exp-1',
          organization: 'Hospital',
          position: 'Volunteer',
          verificationStatus: 'verified' as const,
          verifiedAt: null,
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    });

    render(<NotificationBell />);
    expect(screen.getByTestId('notification-badge')).toBeInTheDocument();
  });
});
