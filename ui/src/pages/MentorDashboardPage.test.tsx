import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { MentorDashboardPage } from './MentorDashboardPage.js';

// Mock useMentorImpact so tests control the data
vi.mock('../hooks/useMentorImpact.js', () => ({
  useMentorImpact: vi.fn(),
}));

// Mock useReadinessConfig — platinumHours defaults to 1000 in these tests (API-063)
vi.mock('../hooks/useReadinessConfig.js', () => ({
  useReadinessConfig: vi.fn(() => ({ data: { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000 } })),
}));

// Mock useVerificationQueue so VerificationQueueCard renders without real fetches
vi.mock('../hooks/useVerificationQueue.js', () => ({
  useVerificationQueue: vi.fn(() => ({ isLoading: false, rows: [], pendingCount: 0 })),
}));

// Mock useCategories consumed by VerificationQueueCard
vi.mock('../hooks/useCategories.js', () => ({
  useCategories: vi.fn(() => ({ data: [], isLoading: false })),
}));

import { useMentorImpact } from '../hooks/useMentorImpact.js';

const mockUseMentorImpact = vi.mocked(useMentorImpact);

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/', element: <MentorDashboardPage /> }],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

describe('MentorDashboardPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('with loaded impact data', () => {
    const mockData = {
      monthHoursVerified: 42,
      lifetimeHoursVerified: 300,
      applicantsMentored: 7,
      avgTurnaroundHours: 18,
      streakDays: 5,
      pendingVerifications: 3,
    };

    beforeEach(() => {
      mockUseMentorImpact.mockReturnValue({
        data: mockData,
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useMentorImpact>);
    });

    it('renders the heading and both placeholder regions', () => {
      renderPage();
      expect(screen.getByRole('heading', { name: /mentor dashboard/i })).toBeInTheDocument();
      expect(screen.getByTestId('mentor-impact-region')).toBeInTheDocument();
      expect(screen.getByTestId('mentor-queue-region')).toBeInTheDocument();
    });

    it('shows the month hours numeral and YOUR IMPACT THIS MONTH eyebrow', () => {
      renderPage();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('YOUR IMPACT THIS MONTH')).toBeInTheDocument();
    });

    it('shows the streak tile', () => {
      renderPage();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('day streak')).toBeInTheDocument();
    });

    it('shows the mentor level label (Gold for 300 hrs)', () => {
      renderPage();
      expect(screen.getByText('Gold')).toBeInTheDocument();
      expect(screen.getByText('mentor level')).toBeInTheDocument();
    });

    it('does NOT show any rank / "Top 5%" text', () => {
      renderPage();
      expect(screen.queryByText(/top 5%/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/rank/i)).not.toBeInTheDocument();
    });

    it('renders all four stat-grid figures', () => {
      renderPage();
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText('Applicants mentored')).toBeInTheDocument();

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('Pending verifications')).toBeInTheDocument();

      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText('Avg turnaround')).toBeInTheDocument();

      // lifetimeHoursVerified 300 appears in both the level derivation and the grid
      expect(screen.getAllByText('300').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Lifetime hrs verified')).toBeInTheDocument();
    });

    it('renders — for null avgTurnaroundHours', () => {
      mockUseMentorImpact.mockReturnValue({
        data: { ...mockData, avgTurnaroundHours: null },
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useMentorImpact>);

      renderPage();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('shows Platinum level for lifetimeHoursVerified >= 1000', () => {
      mockUseMentorImpact.mockReturnValue({
        data: { ...mockData, lifetimeHoursVerified: 1000 },
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useMentorImpact>);

      renderPage();
      expect(screen.getByText('Platinum')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows skeleton while loading and does not crash', () => {
      mockUseMentorImpact.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      } as ReturnType<typeof useMentorImpact>);

      renderPage();
      expect(screen.getByTestId('mentor-impact-region')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows a non-crashing error message on fetch failure', () => {
      mockUseMentorImpact.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      } as ReturnType<typeof useMentorImpact>);

      renderPage();
      expect(screen.getByText(/unable to load impact data/i)).toBeInTheDocument();
    });
  });
});
