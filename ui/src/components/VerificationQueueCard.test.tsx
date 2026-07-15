import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock hooks before importing the component
vi.mock('../hooks/useVerificationQueue.js', () => ({
  useVerificationQueue: vi.fn(),
}));

vi.mock('../hooks/useVerifyExperience.js', () => ({
  useVerifyExperience: vi.fn(),
}));

vi.mock('../hooks/useCategories.js', () => ({
  useCategories: vi.fn(),
}));

import { VerificationQueueCard } from './VerificationQueueCard.js';
import { useVerificationQueue } from '../hooks/useVerificationQueue.js';
import { useVerifyExperience } from '../hooks/useVerifyExperience.js';
import { useCategories } from '../hooks/useCategories.js';

const mockUseVerificationQueue = vi.mocked(useVerificationQueue);
const mockUseVerifyExperience = vi.mocked(useVerifyExperience);
const mockUseCategories = vi.mocked(useCategories);

function makeExperience(overrides: Partial<{
  id: string;
  ownerUserId: string;
  categoryId: string;
  organization: string;
  position: string;
  totalHours: number;
  verificationStatus: 'unverified' | 'verified';
}> = {}) {
  return {
    id: overrides.id ?? 'exp-1',
    ownerUserId: overrides.ownerUserId ?? 'user-app-1',
    categoryId: overrides.categoryId ?? 'cat-1',
    organization: overrides.organization ?? 'City Vet Clinic',
    position: overrides.position ?? 'Veterinary Assistant',
    frequency: null,
    startDate: '2024-01-01',
    endDate: null,
    dutiesNarrative: 'Assisted vets.',
    totalHours: overrides.totalHours ?? 120,
    hoursPerWeek: 10,
    numberOfWeeks: 12,
    stateProvince: null,
    stateProvinceCode: null,
    country: null,
    countryIso2: null,
    countryIso3: null,
    isCurrent: false,
    receivedAcademicCredit: false,
    receivedSalaryOrPayment: false,
    isVolunteer: true,
    isMostImportant: false,
    permissionToContact: false,
    contactTitle: null,
    contactFirstName: null,
    contactLastName: null,
    contactEmail: null,
    contactPhone: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    verificationStatus: (overrides.verificationStatus ?? 'unverified') as 'unverified' | 'verified',
    verifiedByUserId: null,
    verifiedAt: null,
  };
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VerificationQueueCard />
    </QueryClientProvider>,
  );
}

describe('VerificationQueueCard', () => {
  let mutateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mutateMock = vi.fn();

    // Default: two pending rows
    mockUseVerificationQueue.mockReturnValue({
      isLoading: false,
      rows: [
        {
          experience: makeExperience({ id: 'exp-1', totalHours: 120 }),
          applicantName: 'Alice Applicant',
          applicantUserId: 'user-app-1',
        },
        {
          experience: makeExperience({
            id: 'exp-2',
            totalHours: 80,
            organization: 'Rural Animal Hospital',
            position: 'Shadow',
          }),
          applicantName: 'Bob Applicant',
          applicantUserId: 'user-app-2',
        },
      ],
      pendingCount: 2,
    });

    mockUseVerifyExperience.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
    } as unknown as ReturnType<typeof useVerifyExperience>);

    mockUseCategories.mockReturnValue({
      data: [{ id: 'cat-1', name: 'Animal/Veterinary Science', slug: 'animal-vet', sortOrder: 1, isActive: true, createdAt: '2024-01-01' }],
      isLoading: false,
    } as ReturnType<typeof useCategories>);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders two rows with applicant names and Verify buttons', () => {
    renderCard();

    expect(screen.getByText(/Alice Applicant/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Applicant/)).toBeInTheDocument();
    expect(screen.getAllByTestId('verify-button')).toHaveLength(2);
  });

  it('renders the "2 waiting" pill', () => {
    renderCard();

    const pill = screen.getByTestId('waiting-pill');
    expect(pill).toHaveTextContent('2 waiting');
  });

  it('calls mutation with { id, action: "verify" } on Verify click', () => {
    renderCard();

    const buttons = screen.getAllByTestId('verify-button');
    fireEvent.click(buttons[0]);

    expect(mutateMock).toHaveBeenCalledWith(
      { id: 'exp-1', action: 'verify' },
      expect.any(Object),
    );
  });

  it('row shows green-check + hrs after clicking Verify (optimistic)', async () => {
    renderCard();

    const buttons = screen.getAllByTestId('verify-button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByText('+120 hrs')).toBeInTheDocument();
    });
  });

  it('"cleared today" increments to 1 after clicking Verify', async () => {
    renderCard();

    const buttons = screen.getAllByTestId('verify-button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      // The progress text reads "1 of 3 cleared today"
      // (1 cleared, 2 pending initially = total 3? No wait:
      //  clearedToday = 1, pendingCount = 2 from hook = total 3)
      // Actually pendingCount doesn't change until refetch, so total = 1 + 2 = 3
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('renders empty-state message when there are no pending rows', () => {
    mockUseVerificationQueue.mockReturnValue({
      isLoading: false,
      rows: [],
      pendingCount: 0,
    });

    renderCard();

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('reverts optimistic state when mutation errors', async () => {
    // Mutation calls onError callback
    mutateMock.mockImplementation((_vars: unknown, opts: { onError?: () => void }) => {
      opts.onError?.();
    });

    renderCard();

    const buttons = screen.getAllByTestId('verify-button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Verification failed/i)).toBeInTheDocument();
    });
  });

  it('optimistic UI renders synchronously on click — before the mutation promise settles (TEST-051)', () => {
    // Configure mutate to be an in-flight no-op: it never resolves or calls
    // onError, simulating a network request that is still outstanding.
    mutateMock.mockImplementation(() => {
      // Intentionally returns undefined — the mutation is explicitly pending.
    });

    renderCard();
    const buttons = screen.getAllByTestId('verify-button');

    // Act: fire the click. React 18 + @testing-library flush state updates
    // synchronously inside act(), so we can assert WITHOUT await.
    fireEvent.click(buttons[0]);

    // The optimistic "+N hrs" treatment must be visible immediately — before
    // any async work settles — because setRowState('optimistic') is called
    // synchronously in handleVerify() before mutate() is invoked.
    expect(screen.getByText('+120 hrs')).toBeInTheDocument();

    // The "cleared today" counter also increments synchronously.
    // The '1' appears in the progress line: "1 of 3 cleared today".
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
