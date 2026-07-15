import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RootRedirect } from './RootRedirect.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(meData?: {
  user: { id: string; email: string; name: string };
  roles: string[];
  hasMentorGrants: boolean;
}): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (meData !== undefined) {
    qc.setQueryData(['me'], meData);
  }
  return qc;
}

function renderRedirect(queryClient: QueryClient) {
  const routes = [
    { path: '/', element: <RootRedirect /> },
    { path: '/home', element: <div>home page</div> },
    { path: '/admin', element: <div>admin page</div> },
  ];

  const router = createMemoryRouter(routes, { initialEntries: ['/'] });

  return { router, ...render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  ) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RootRedirect', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('redirects an applicant to /home', async () => {
    const qc = makeQueryClient({
      user: { id: 'u1', email: 'app@example.com', name: 'Applicant' },
      roles: ['applicant'],
      hasMentorGrants: false,
    });

    const { getByText } = renderRedirect(qc);

    await waitFor(() => {
      expect(getByText('home page')).toBeInTheDocument();
    });
  });

  it('redirects a mentor to /home', async () => {
    const qc = makeQueryClient({
      user: { id: 'u2', email: 'mentor@example.com', name: 'Mentor' },
      roles: ['applicant'],
      hasMentorGrants: true,
    });

    const { getByText } = renderRedirect(qc);

    await waitFor(() => {
      expect(getByText('home page')).toBeInTheDocument();
    });
  });

  it('redirects an admin to /admin', async () => {
    const qc = makeQueryClient({
      user: { id: 'u3', email: 'admin@example.com', name: 'Admin' },
      roles: ['admin', 'applicant'],
      hasMentorGrants: false,
    });

    const { getByText } = renderRedirect(qc);

    await waitFor(() => {
      expect(getByText('admin page')).toBeInTheDocument();
    });
  });

  it('renders a loading status while data is resolving (no data in cache)', () => {
    // No me data seeded — query stays in loading state; fetch never resolves
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => { /* never resolves */ })));

    const qc = makeQueryClient();

    const routes = [
      { path: '/', element: <RootRedirect /> },
      { path: '/experiences', element: <div>experiences page</div> },
      { path: '/admin', element: <div>admin page</div> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });

    const { getByRole } = render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // Should show accessible loading status, not a blank page
    expect(getByRole('status')).toBeInTheDocument();
    expect(getByRole('status').textContent).toBe('Loading…');
  });
});
