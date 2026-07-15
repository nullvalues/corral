/**
 * HomePage derivation tests — end-to-end against seeded React Query data.
 *
 * Asserts:
 *  1. The readiness hero numeral equals computeReadiness(...) for the seeded data.
 *  2. The 3-up stat numerals match the derived totalHours, verifiedCount, and
 *     experienceCount.
 *  3. The "M of N goals met" pill reflects goalMet over goal-bearing categories.
 *  4. Crossing a category goal mounts CelebrationOverlay exactly once.
 *
 * useAnimatedNumber is mocked to return target directly so the ramp-up animation
 * never runs — the settled value is asserted immediately.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage.js';
import { computeReadiness } from '../lib/readiness.js';

// ---------------------------------------------------------------------------
// Mock useAnimatedNumber to settle immediately on the target value so that
// assertions on the readiness numeral are deterministic and require no timing.
// ---------------------------------------------------------------------------
vi.mock('../hooks/useAnimatedNumber.js', () => ({
  useAnimatedNumber: (target: number) => target,
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const UID = 'user-derive-001';

const ME = {
  user: { id: UID, email: 'derive@example.com', name: 'Derive User' },
  roles: ['applicant'],
  hasMentorGrants: false,
};

// Two goal-bearing active categories.
const CATEGORIES = [
  {
    id: 'cat-hc',
    slug: 'healthcare-experience',
    name: 'Healthcare Experience',
    goalHours: 500,
    isActive: true,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-vol',
    slug: 'volunteer-experience',
    name: 'Volunteer Experience',
    goalHours: 300,
    isActive: true,
    sortOrder: 2,
    createdAt: '2024-01-01T00:00:00Z',
  },
];

// healthcare at 600/500 hrs (goal met), volunteer at 100/300 hrs (goal not met).
const ROLLUP = [
  {
    categoryId: 'cat-hc',
    categorySlug: 'healthcare-experience',
    categoryName: 'Healthcare Experience',
    totalHours: 600,
  },
  {
    categoryId: 'cat-vol',
    categorySlug: 'volunteer-experience',
    categoryName: 'Volunteer Experience',
    totalHours: 100,
  },
];

const EXPERIENCES = [
  { id: 'exp-1', categoryId: 'cat-hc', verificationStatus: 'verified' as const },
  { id: 'exp-2', categoryId: 'cat-vol', verificationStatus: 'unverified' as const },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(
  rollup = ROLLUP,
  experiences = EXPERIENCES,
  categories = CATEGORIES,
): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(['session'], { user: { id: UID } });
  qc.setQueryData(['me'], ME);
  qc.setQueryData(['rollup', UID], rollup);
  qc.setQueryData(['experiences', UID], experiences);
  qc.setQueryData(['categories'], categories);
  // Seed the readiness-config cache with the code-default weights so the page's
  // useReadinessConfig() resolves from cache (staleTime Infinity) and the derived
  // readiness equals computeReadiness(...) with DEFAULT_READINESS_WEIGHTS.
  qc.setQueryData(['readinessConfig'], { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15 });
  return qc;
}

type MilestoneView = {
  key: string;
  label: string;
  earned: boolean;
  earnedAt: string | null;
  remainingLabel: string | null;
};

function renderPage(qc: QueryClient, milestones: MilestoneView[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const body = url === '/api/me/milestones' ? JSON.stringify(milestones) : '[]';
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Derivation assertions
// ---------------------------------------------------------------------------

describe('HomePage derivation', () => {
  it('readiness hero numeral equals computeReadiness for the seeded rollup/experiences/categories', async () => {
    const qc = makeQueryClient();
    renderPage(qc);

    const expectedReadiness = computeReadiness({
      rollup: ROLLUP,
      experiences: EXPERIENCES.map((e) => ({
        categoryId: e.categoryId,
        verificationStatus: e.verificationStatus,
      })),
      activeCategories: CATEGORIES.filter((c) => c.isActive).map((c) => ({
        id: c.id,
        goalHours: c.goalHours,
      })),
    });

    await waitFor(() => {
      const hero = screen.getByTestId('readiness-hero');
      // The ProgressRing renders the settled value as plain text inside the hero.
      expect(within(hero).getByText(String(expectedReadiness))).toBeInTheDocument();
    });
  });

  it('3-up stats: total-hours equals rollup sum', async () => {
    const qc = makeQueryClient();
    renderPage(qc);

    const expectedTotalHours = ROLLUP.reduce((s, r) => s + r.totalHours, 0); // 700

    await waitFor(() => {
      expect(screen.getByTestId('stat-total-hours')).toHaveTextContent(
        String(expectedTotalHours),
      );
    });
  });

  it('3-up stats: verified count equals experiences with verificationStatus="verified"', async () => {
    const qc = makeQueryClient();
    renderPage(qc);

    const expectedVerified = EXPERIENCES.filter(
      (e) => e.verificationStatus === 'verified',
    ).length; // 1

    await waitFor(() => {
      expect(screen.getByTestId('stat-verified')).toHaveTextContent(
        String(expectedVerified),
      );
    });
  });

  it('3-up stats: experiences count equals total seeded experiences', async () => {
    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByTestId('stat-experiences')).toHaveTextContent(
        String(EXPERIENCES.length), // 2
      );
    });
  });

  it('"M of N goals met" pill reflects goalMet over goal-bearing categories', async () => {
    // cat-hc: 600hrs, goal=500 → met (1)
    // cat-vol: 100hrs, goal=300 → not met (0)
    // goalBearing = 2 (both have non-null goals)
    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByTestId('goals-pill')).toHaveTextContent('1 of 2 goals met');
    });
  });
});

// ---------------------------------------------------------------------------
// Celebration overlay
// ---------------------------------------------------------------------------

describe('HomePage celebration', () => {
  it('mounts CelebrationOverlay exactly once when the server confirms a newly-awarded milestone', async () => {
    // Pre-seed the milestone-award baseline with only first_experience (so this is
    // not the first observation). The server (/api/me/milestones) reports hours_100
    // as newly earned, which is NOT in the baseline → single-fire celebration.
    const awardKey = `asp:ms-awarded:${UID}`;
    localStorage.setItem(awardKey, JSON.stringify(['first_experience']));

    const milestones: MilestoneView[] = [
      { key: 'first_experience', label: 'First experience', earned: true, earnedAt: '2026-01-01T00:00:00Z', remainingLabel: null },
      { key: 'hours_100', label: '100 hours logged', earned: true, earnedAt: '2026-02-01T00:00:00Z', remainingLabel: null },
    ];

    const qc = makeQueryClient();
    renderPage(qc, milestones);

    // CelebrationOverlay renders role="dialog" with aria-label="Goal reached"
    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Goal reached' }),
      ).toBeInTheDocument();
    });

    // Exactly one overlay mounted, naming the newly-awarded milestone label.
    const dialogs = screen.getAllByRole('dialog', { name: 'Goal reached' });
    expect(dialogs).toHaveLength(1);
    // The overlay copy names the newly-awarded milestone label.
    expect(dialogs[0].textContent).toContain('100 hours logged');
  });
});
