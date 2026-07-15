import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../hooks/useTalentPool.js', () => ({
  useTalentPool: vi.fn(),
}));
vi.mock('../hooks/useReadinessConfig.js', () => ({
  useReadinessConfig: vi.fn(),
}));

import { RisingCandidatesCard } from './RisingCandidatesCard.js';
import { useTalentPool } from '../hooks/useTalentPool.js';
import { useReadinessConfig } from '../hooks/useReadinessConfig.js';

const mockUseTalentPool = vi.mocked(useTalentPool);
const mockUseReadinessConfig = vi.mocked(useReadinessConfig);

function makeEntry(over: {
  id: string;
  name: string;
  totalHours: number;
  experienceCount: number;
  verifiedCount: number;
}) {
  return {
    applicantUserId: over.id,
    applicantName: over.name,
    applicantEmail: `${over.id}@example.com`,
    categories: [
      {
        categoryId: `${over.id}-cat`,
        categorySlug: 'patient-care-experience',
        categoryName: 'Patient Care',
        totalHours: over.totalHours,
        experienceCount: over.experienceCount,
        verifiedCount: over.verifiedCount,
      },
    ],
    experienceCount: over.experienceCount,
    verifiedCount: over.verifiedCount,
    activeCategoryCount: 1,
    shortlisted: false,
    starRating: null,
  };
}

// C: 1000 hrs, 2/2 verified → readiness 100
// A: 500 hrs, 1/2 verified  → readiness 58
// B: 100 hrs, 0/1 verified  → readiness 21
const CANDIDATE_C = makeEntry({ id: 'c', name: 'Cara Candidate', totalHours: 1000, experienceCount: 2, verifiedCount: 2 });
const CANDIDATE_A = makeEntry({ id: 'a', name: 'Alan Applicant', totalHours: 500, experienceCount: 2, verifiedCount: 1 });
const CANDIDATE_B = makeEntry({ id: 'b', name: 'Bea Builder', totalHours: 100, experienceCount: 1, verifiedCount: 0 });

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RisingCandidatesCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RisingCandidatesCard', () => {
  beforeEach(() => {
    mockUseReadinessConfig.mockReturnValue({ data: undefined } as ReturnType<typeof useReadinessConfig>);
    mockUseTalentPool.mockReturnValue({
      data: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C],
      isLoading: false,
    } as ReturnType<typeof useTalentPool>);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders rows ranked by readiness descending (C > A > B) with C at rank 1', () => {
    renderCard();
    const row1 = screen.getByTestId('rising-rank-1');
    const row2 = screen.getByTestId('rising-rank-2');
    const row3 = screen.getByTestId('rising-rank-3');
    expect(row1).toHaveTextContent('Cara Candidate');
    expect(row2).toHaveTextContent('Alan Applicant');
    expect(row3).toHaveTextContent('Bea Builder');
    expect(row1).toHaveTextContent('100%');
  });

  it('rank-1 row carries the highlight treatment and a filled star; others do not', () => {
    renderCard();
    const row1 = screen.getByTestId('rising-rank-1');
    const row2 = screen.getByTestId('rising-rank-2');
    expect(row1).toHaveClass('bg-primary-50');
    expect(within(row1).getByTestId('rising-star-filled')).toBeInTheDocument();
    expect(row2).not.toHaveClass('bg-primary-50');
    expect(within(row2).getByTestId('rising-star-outline')).toBeInTheDocument();
    expect(within(row2).queryByTestId('rising-star-filled')).toBeNull();
  });

  it('"View full talent pool" links to /mentor/talent-pool', () => {
    renderCard();
    const link = screen.getByTestId('view-full-talent-pool');
    expect(link).toHaveAttribute('href', '/mentor/talent-pool');
  });

  it('renders the empty state when the pool is empty', () => {
    mockUseTalentPool.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useTalentPool>);
    renderCard();
    expect(screen.getByText(/no candidates yet/i)).toBeInTheDocument();
  });

  it('renders a loading skeleton while fetching', () => {
    mockUseTalentPool.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useTalentPool>);
    renderCard();
    expect(screen.getAllByTestId('rising-skeleton').length).toBeGreaterThan(0);
  });
});
