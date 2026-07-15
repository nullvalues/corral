import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../hooks/useTalentPool.js', () => ({
  useTalentPool: vi.fn(),
}));
vi.mock('../hooks/useReadinessConfig.js', () => ({
  useReadinessConfig: vi.fn(),
}));

import { TalentPoolPage } from './TalentPoolPage.js';
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

const C = makeEntry({ id: 'c', name: 'Cara Candidate', totalHours: 1000, experienceCount: 2, verifiedCount: 2 });
const A = makeEntry({ id: 'a', name: 'Alan Applicant', totalHours: 500, experienceCount: 2, verifiedCount: 1 });
const B = makeEntry({ id: 'b', name: 'Bea Builder', totalHours: 100, experienceCount: 1, verifiedCount: 0 });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TalentPoolPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TalentPoolPage', () => {
  beforeEach(() => {
    mockUseReadinessConfig.mockReturnValue({ data: undefined } as ReturnType<typeof useReadinessConfig>);
    mockUseTalentPool.mockReturnValue({
      data: [A, B, C],
      isLoading: false,
    } as ReturnType<typeof useTalentPool>);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders all entries ranked by readiness', () => {
    renderPage();
    const row1 = screen.getByTestId('talent-pool-rank-1');
    const row2 = screen.getByTestId('talent-pool-rank-2');
    const row3 = screen.getByTestId('talent-pool-rank-3');
    expect(row1).toHaveTextContent('Cara Candidate');
    expect(row2).toHaveTextContent('Alan Applicant');
    expect(row3).toHaveTextContent('Bea Builder');
  });

  it('renders an empty state when the pool is empty', () => {
    mockUseTalentPool.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useTalentPool>);
    renderPage();
    expect(screen.getByText(/no candidates yet/i)).toBeInTheDocument();
  });
});
