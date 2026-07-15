import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UsersAdminPage } from './UsersAdminPage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ME_RESPONSE = {
  user: { id: 'u-1', email: 'admin@example.com', name: 'Ada Admin' },
  roles: ['admin', 'applicant'],
  hasMentorGrants: false,
};

const PAGE_1 = {
  users: [
    {
      id: 'u-1',
      email: 'admin@example.com',
      name: 'Ada Admin',
      roles: ['admin', 'applicant'],
      activeMentorGrantCount: 2,
    },
    {
      id: 'u-2',
      email: 'app@example.com',
      name: 'Al Applicant',
      roles: ['applicant'],
      activeMentorGrantCount: 0,
    },
  ],
  totalCount: 25,
};

const PAGE_2 = {
  users: [
    {
      id: 'u-3',
      email: 'page2@example.com',
      name: 'Page Two',
      roles: ['applicant'],
      activeMentorGrantCount: 1,
    },
  ],
  totalCount: 25,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Default fetch mock: /api/me → ME_RESPONSE, /api/users → PAGE_1 */
function defaultFetch(url: string): Promise<Response> {
  if (url.includes('/api/me')) return Promise.resolve(jsonResponse(ME_RESPONSE));
  return Promise.resolve(jsonResponse(PAGE_1));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — existing behaviour
// ---------------------------------------------------------------------------

describe('UsersAdminPage', () => {
  it('renders the user table with email, name, role badges, and grant counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(defaultFetch));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    });

    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('app@example.com')).toBeInTheDocument();
    expect(screen.getByText('Al Applicant')).toBeInTheDocument();
    // Role badges
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getAllByText('applicant').length).toBeGreaterThanOrEqual(2);
    // Grant counts
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/me')) return Promise.resolve(jsonResponse(ME_RESPONSE));
        return Promise.resolve(jsonResponse({ error: 'boom' }, 500));
      }),
    );

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/failed to load users/i)).toBeInTheDocument();
    });
  });

  it('advances to the next page when Next is clicked', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/me')) return Promise.resolve(jsonResponse(ME_RESPONSE));
      if (url.includes('page=2')) return Promise.resolve(jsonResponse(PAGE_2));
      return Promise.resolve(jsonResponse(PAGE_1));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    });

    expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('page2@example.com')).toBeInTheDocument();
    });

    expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument();
  });

  it('disables Prev on the first page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(defaultFetch));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // Tests — role toggle (UI-032)
  // ---------------------------------------------------------------------------

  it('shows "Make admin" for applicant-only users and "Remove admin" for admin users', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(defaultFetch));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole('button', { name: /remove admin/i });
    const makeButtons = screen.getAllByRole('button', { name: /make admin/i });

    // u-1 (admin@example.com) has admin role → "Remove admin"
    // u-2 (app@example.com) has no admin role → "Make admin"
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
    expect(makeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('disables the action button for the current user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(defaultFetch));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    });

    // The current user is u-1 (admin@example.com). Find all "Remove admin" buttons.
    // The one belonging to u-1 should be disabled.
    const removeButtons = screen.getAllByRole('button', { name: /remove admin/i });
    // u-1 row is first; its button should be disabled
    const currentUserButton = removeButtons[0];
    expect(currentUserButton).toBeDisabled();
    expect(currentUserButton).toHaveAttribute('title', 'Cannot change your own role');
  });

  it('calls PATCH /api/users/:id/roles with grant action when Make admin is confirmed', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/me')) return Promise.resolve(jsonResponse(ME_RESPONSE));
      if (url.includes('/api/users/u-2/roles') && opts?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ success: true }));
      }
      return Promise.resolve(jsonResponse(PAGE_1));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('app@example.com')).toBeInTheDocument();
    });

    const makeAdminButtons = screen.getAllByRole('button', { name: /make admin/i });
    fireEvent.click(makeAdminButtons[0]);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (args: unknown[]) => {
          const [url, opts] = args as [string, RequestInit];
          return url.includes('/api/users/u-2/roles') && opts?.method === 'PATCH';
        },
      );
      expect(patchCall).toBeDefined();
      if (patchCall) {
        const opts = patchCall[1] as RequestInit;
        const body = JSON.parse(opts.body as string);
        expect(body).toEqual({ role: 'admin', action: 'grant' });
      }
    });
  });

  it('calls PATCH /api/users/:id/roles with revoke action when Remove admin is confirmed for a non-self user', async () => {
    // Use a different current user so u-1's "Remove admin" is not disabled
    const me = { user: { id: 'u-99', email: 'other@example.com', name: 'Other' }, roles: ['admin'], hasMentorGrants: false };
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/me')) return Promise.resolve(jsonResponse(me));
      if (url.includes('/api/users/u-1/roles') && opts?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ success: true }));
      }
      return Promise.resolve(jsonResponse(PAGE_1));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole('button', { name: /remove admin/i });
    // u-1 is not the current user now, so this button is enabled
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (args: unknown[]) => {
          const [url, opts] = args as [string, RequestInit];
          return url.includes('/api/users/u-1/roles') && opts?.method === 'PATCH';
        },
      );
      expect(patchCall).toBeDefined();
      if (patchCall) {
        const opts = patchCall[1] as RequestInit;
        const body = JSON.parse(opts.body as string);
        expect(body).toEqual({ role: 'admin', action: 'revoke' });
      }
    });
  });

  it('does not call the API when confirm is cancelled', async () => {
    const fetchMock = vi.fn().mockImplementation(defaultFetch);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('app@example.com')).toBeInTheDocument();
    });

    const makeAdminButtons = screen.getAllByRole('button', { name: /make admin/i });
    fireEvent.click(makeAdminButtons[0]);

    // No PATCH calls should have been made
    const patchCalls = fetchMock.mock.calls.filter(
      (args: unknown[]) => {
        const [, opts] = args as [string, RequestInit];
        return opts?.method === 'PATCH';
      },
    );
    expect(patchCalls.length).toBe(0);
  });

  it('shows inline error message on 409 last-admin response', async () => {
    const me = { user: { id: 'u-99', email: 'other@example.com', name: 'Other' }, roles: ['admin'], hasMentorGrants: false };
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/me')) return Promise.resolve(jsonResponse(me));
      if (url.includes('/api/users/u-1/roles') && opts?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: 'last admin' }, 409));
      }
      return Promise.resolve(jsonResponse(PAGE_1));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <UsersAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole('button', { name: /remove admin/i });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(
        screen.getByText(/cannot remove the last admin account/i),
      ).toBeInTheDocument();
    });
  });
});
