import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ApplicantLayout } from './ApplicantLayout.js';

// Mock useMe so tests are isolated from fetch and QueryClient state (UI-906).
vi.mock('../hooks/useMe.js', () => ({
  useMe: vi.fn(),
}));

import { useMe } from '../hooks/useMe.js';

// Mock Navigate to render a sentinel so we can assert it without real routing
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="navigate-redirect" data-to={to} />
    ),
  };
});

function mockMe(roles: string[], isLoading = false) {
  vi.mocked(useMe).mockReturnValue({
    data: isLoading
      ? undefined
      : { user: { id: 'u1', email: 'u@b.com', name: 'U' }, roles, hasMentorGrants: false },
    isLoading,
  } as unknown as ReturnType<typeof useMe>);
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route element={<ApplicantLayout />}>
            <Route path="/home" element={<div>applicant outlet content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ApplicantLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state while useMe is loading', () => {
    mockMe([], true);
    renderLayout();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders the Outlet + bottom tab bar for an applicant account', async () => {
    mockMe(['applicant']);
    renderLayout();

    await waitFor(() => {
      expect(screen.getByText('applicant outlet content')).toBeInTheDocument();
    });
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
  });

  it('redirects to /admin for an admin-only account (no applicant role)', async () => {
    mockMe(['admin']);
    renderLayout();

    await waitFor(() => {
      const el = screen.getByTestId('navigate-redirect');
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute('data-to', '/admin');
    });
    expect(screen.queryByText('applicant outlet content')).not.toBeInTheDocument();
  });
});
