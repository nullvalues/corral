import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UID = 'user-test-001';

const ME = {
  user: { id: UID, email: 'test@example.com', name: 'Test User' },
  roles: ['applicant'],
  hasMentorGrants: false,
};

const CATEGORIES = [
  { id: 'cat-hc', slug: 'healthcare-experience', name: 'Healthcare Experience', goalHours: 500, isActive: true, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z' },
  { id: 'cat-emp', slug: 'employment', name: 'Employment', goalHours: null, isActive: true, sortOrder: 2, createdAt: '2024-01-01T00:00:00Z' },
];

// Healthcare at 250/500 hrs (50%), 4 total experiences (2 verified)
const ROLLUP = [
  { categoryId: 'cat-hc', categorySlug: 'healthcare-experience', categoryName: 'Healthcare Experience', totalHours: 250 },
];

const EXPERIENCES = [
  { id: 'exp-1', categoryId: 'cat-hc', verificationStatus: 'verified' as const },
  { id: 'exp-2', categoryId: 'cat-hc', verificationStatus: 'verified' as const },
  { id: 'exp-3', categoryId: 'cat-hc', verificationStatus: 'unverified' as const },
  { id: 'exp-4', categoryId: 'cat-emp', verificationStatus: 'unverified' as const },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  // Seed session so useCurrentUserId resolves
  qc.setQueryData(['session'], { user: { id: UID } });
  qc.setQueryData(['me'], ME);
  qc.setQueryData(['rollup', UID], ROLLUP);
  qc.setQueryData(['experiences', UID], EXPERIENCES);
  qc.setQueryData(['categories'], CATEGORIES);

  return qc;
}

function renderPage() {
  // Stub fetch so hooks don't make actual network calls
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ));

  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Empty-state helper
// ---------------------------------------------------------------------------

function makeEmptyQueryClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  qc.setQueryData(['session'], { user: { id: UID } });
  qc.setQueryData(['me'], ME);
  qc.setQueryData(['rollup', UID], []);
  // isSuccess is true when data is set via setQueryData
  qc.setQueryData(['experiences', UID], []);
  qc.setQueryData(['categories'], CATEGORIES);

  return qc;
}

function renderEmptyPage() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ));
  const qc = makeEmptyQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HomePage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the correct total-hours numeral', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('stat-total-hours')).toHaveTextContent('250');
    });
  });

  it('shows the correct verified-count numeral', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('stat-verified')).toHaveTextContent('2');
    });
  });

  it('shows the correct experiences-count numeral', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('stat-experiences')).toHaveTextContent('4');
    });
  });

  it('shows the correct goals-met pill text', async () => {
    renderPage();
    // healthcare-experience has goal=500, hours=250 → not met.
    // employment has goal=null → not goal-bearing.
    // So goalBearing=[healthcare-experience], goalsMet=0 → "0 of 1 goals met"
    await waitFor(() => {
      expect(screen.getByTestId('goals-pill')).toHaveTextContent('0 of 1 goals met');
    });
  });

  it('shows a percentage for a goal-bearing category card', async () => {
    renderPage();
    // Healthcare at 250/500 = 50%
    await waitFor(() => {
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });

  it('shows "No hour minimum for this category" for a no-goal category card', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No hour minimum for this category')).toBeInTheDocument();
    });
  });

  it('renders the readiness hero ring', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('readiness-hero')).toBeInTheDocument();
    });
  });

  it('shows the "Add your first experience" CTA when experiences list is empty', async () => {
    renderEmptyPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add your first experience' })).toBeInTheDocument();
    });
  });

  it('shows "How it works" copy when experiences list is empty', async () => {
    renderEmptyPage();
    await waitFor(() => {
      expect(screen.getByText('How it works')).toBeInTheDocument();
    });
  });

  it('shows goal-bearing category preview with "0 of <goal> hr goal" when empty', async () => {
    renderEmptyPage();
    // healthcare-experience has goal=500
    await waitFor(() => {
      expect(screen.getByText('0 of 500 hr goal')).toBeInTheDocument();
    });
  });

  it('shows no-goal category preview with "No hour minimum" when empty', async () => {
    renderEmptyPage();
    // employment has goal=null
    await waitFor(() => {
      expect(screen.getByText('No hour minimum')).toBeInTheDocument();
    });
  });

  it('does NOT show the empty state when experiences list is non-empty', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Add your first experience')).not.toBeInTheDocument();
      expect(screen.getByTestId('readiness-hero')).toBeInTheDocument();
    });
  });
});
