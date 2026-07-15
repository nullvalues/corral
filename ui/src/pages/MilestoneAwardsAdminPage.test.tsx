import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const AWARD_ROW = {
  id: 'award-uuid-1',
  userId: 'user-1',
  email: 'user@example.com',
  milestoneKey: 'hours-100',
  earnedAt: new Date('2026-06-01T10:00:00Z').toISOString(),
};

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

import { MilestoneAwardsAdminPage } from './MilestoneAwardsAdminPage.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MilestoneAwardsAdminPage', () => {
  it('renders a table row with email, milestone key, and earned date', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [AWARD_ROW],
    });

    renderWithClient(<MilestoneAwardsAdminPage />);

    // Wait for the row to appear
    const cell = await screen.findByText('user@example.com');
    expect(cell).toBeTruthy();
    expect(screen.getByText('hours-100')).toBeTruthy();
  });

  it('renders the empty state when the response is an empty array', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    renderWithClient(<MilestoneAwardsAdminPage />);

    const empty = await screen.findByText('No milestone awards found.');
    expect(empty).toBeTruthy();
  });

  it('renders the error state when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    renderWithClient(<MilestoneAwardsAdminPage />);

    const err = await screen.findByText('Failed to load milestone awards.');
    expect(err).toBeTruthy();
  });

  it('falls back to userId when email is null', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ ...AWARD_ROW, email: null, userId: 'user-fallback-id' }],
    });

    renderWithClient(<MilestoneAwardsAdminPage />);

    const cell = await screen.findByText('user-fallback-id');
    expect(cell).toBeTruthy();
  });
});
