import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MentorLevelBadge } from './MentorLevelBadge.js';
import { PLATINUM_HOURS, hoursToNextLevel } from '../lib/mentorLevel.js';

// Mock useMentorImpact so the component renders without a network call.
vi.mock('../hooks/useMentorImpact.js', () => ({
  useMentorImpact: vi.fn(),
}));

// Mock useReadinessConfig — platinumHours defaults to 1000 in these tests (API-063)
vi.mock('../hooks/useReadinessConfig.js', () => ({
  useReadinessConfig: vi.fn(() => ({ data: { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000 } })),
}));

import { useMentorImpact } from '../hooks/useMentorImpact.js';
const mockUseMentorImpact = useMentorImpact as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── threshold helper unit assertions ──────────────────────────────────────────

describe('hoursToNextLevel', () => {
  it('returns PLATINUM_HOURS − lifetimeHours when below threshold', () => {
    expect(hoursToNextLevel(680)).toBe(320);
    expect(hoursToNextLevel(680)).toBe(PLATINUM_HOURS - 680);
  });

  it('returns null when at Platinum threshold', () => {
    expect(hoursToNextLevel(1000)).toBeNull();
  });

  it('returns null when above Platinum threshold', () => {
    expect(hoursToNextLevel(1500)).toBeNull();
  });

  it('returns PLATINUM_HOURS when lifetimeHours is 0', () => {
    expect(hoursToNextLevel(0)).toBe(PLATINUM_HOURS);
  });
});

// ── MentorLevelBadge component ─────────────────────────────────────────────

describe('MentorLevelBadge — Gold level (680 hrs)', () => {
  beforeEach(() => {
    mockUseMentorImpact.mockReturnValue({
      data: { lifetimeHoursVerified: 680 },
      isLoading: false,
    });
    render(<MentorLevelBadge />);
  });

  it('renders "Gold mentor" level', () => {
    expect(screen.getByText('Gold mentor')).toBeInTheDocument();
  });

  it('renders a "320 hrs to Platinum" progress line', () => {
    expect(screen.getByText('320 hrs to Platinum')).toBeInTheDocument();
  });

  it('does not render the top-tier label', () => {
    expect(screen.queryByText('Top tier')).not.toBeInTheDocument();
  });
});

describe('MentorLevelBadge — Platinum level (1000 hrs)', () => {
  beforeEach(() => {
    mockUseMentorImpact.mockReturnValue({
      data: { lifetimeHoursVerified: 1000 },
      isLoading: false,
    });
    render(<MentorLevelBadge />);
  });

  it('renders "Platinum mentor" level', () => {
    expect(screen.getByText('Platinum mentor')).toBeInTheDocument();
  });

  it('renders the top-tier label', () => {
    expect(screen.getByText('Top tier')).toBeInTheDocument();
  });

  it('does not render a "to Platinum" line', () => {
    expect(screen.queryByText(/to Platinum/i)).not.toBeInTheDocument();
  });
});

describe('MentorLevelBadge — no banned text in either render', () => {
  it('contains no leaderboard / rank / percentile text at Gold level', () => {
    mockUseMentorImpact.mockReturnValue({
      data: { lifetimeHoursVerified: 680 },
      isLoading: false,
    });
    const { container } = render(<MentorLevelBadge />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/top 5/i);
    expect(text).not.toMatch(/rank/i);
    expect(text).not.toMatch(/leaderboard/i);
    expect(text).not.toMatch(/percentile/i);
  });

  it('contains no leaderboard / rank / percentile text at Platinum level', () => {
    mockUseMentorImpact.mockReturnValue({
      data: { lifetimeHoursVerified: 1000 },
      isLoading: false,
    });
    const { container } = render(<MentorLevelBadge />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/top 5/i);
    expect(text).not.toMatch(/rank/i);
    expect(text).not.toMatch(/leaderboard/i);
    expect(text).not.toMatch(/percentile/i);
  });
});

describe('MentorLevelBadge — loading state', () => {
  it('renders a loading placeholder and does not crash', () => {
    mockUseMentorImpact.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<MentorLevelBadge />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('MentorLevelBadge — undefined data', () => {
  it('renders nothing when data is undefined and not loading', () => {
    mockUseMentorImpact.mockReturnValue({ data: undefined, isLoading: false });
    const { container } = render(<MentorLevelBadge />);
    expect(container.firstChild).toBeNull();
  });
});
