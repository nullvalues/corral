import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminLayout } from './AdminLayout.js';

// Mock useMe so tests are isolated from fetch and QueryClient state
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

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderAdminLayout() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AdminLayout />}>
            <Route index element={<div>admin outlet content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state while useMe is loading', () => {
    vi.mocked(useMe).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useMe>);

    renderAdminLayout();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('admin outlet content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
  });

  it('renders <Navigate to="/experiences" /> when useMe resolves with no roles', async () => {
    vi.mocked(useMe).mockReturnValue({
      data: { user: { id: 'u1', email: 'a@b.com', name: 'A' }, roles: [], hasMentorGrants: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);

    renderAdminLayout();

    await waitFor(() => {
      const el = screen.getByTestId('navigate-redirect');
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute('data-to', '/experiences');
    });

    expect(screen.queryByText('admin outlet content')).not.toBeInTheDocument();
  });

  it('renders <Navigate to="/experiences" /> when useMe resolves with non-admin roles', async () => {
    vi.mocked(useMe).mockReturnValue({
      data: {
        user: { id: 'u2', email: 'b@b.com', name: 'B' },
        roles: ['applicant'],
        hasMentorGrants: false,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);

    renderAdminLayout();

    await waitFor(() => {
      const el = screen.getByTestId('navigate-redirect');
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute('data-to', '/experiences');
    });

    expect(screen.queryByText('admin outlet content')).not.toBeInTheDocument();
  });

  it('renders the Outlet when useMe resolves with admin role', async () => {
    vi.mocked(useMe).mockReturnValue({
      data: {
        user: { id: 'u3', email: 'admin@b.com', name: 'Admin' },
        roles: ['admin'],
        hasMentorGrants: false,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useMe>);

    renderAdminLayout();

    await waitFor(() => {
      expect(screen.getByText('admin outlet content')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute(
      'href',
      '/admin/categories',
    );
    expect(screen.getByRole('link', { name: 'Grants' })).toHaveAttribute('href', '/admin/grants');
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users');
  });
});
