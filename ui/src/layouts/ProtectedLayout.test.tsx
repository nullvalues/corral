import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProtectedLayout } from './ProtectedLayout.js';

// Mock react-router-dom's useNavigate
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderProtectedLayout() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route index element={<div>protected content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Routes fetch mocks by URL: a valid session + a /api/me payload with the given roles.
function mockSessionAndMe(roles: string[], hasMentorGrants = false) {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    if (url.includes('/api/me')) {
      return Promise.resolve(
        jsonResponse({ user: { id: 'u1', email: 'a@b.c', name: 'A' }, roles, hasMentorGrants }),
      );
    }
    if (url.includes('/api/auth/sign-out')) {
      return Promise.resolve(jsonResponse({}, 200));
    }
    // get-session
    return Promise.resolve(jsonResponse({ user: { twoFactorEnabled: true } }));
  });
}

describe('ProtectedLayout', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('redirects to /sign-in when session is null (no session)', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse(null)));

    renderProtectedLayout();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/sign-in', { replace: true });
    });

    expect(navigateMock).not.toHaveBeenCalledWith('/enrol', { replace: true });
  });

  it('redirects to /enrol when session has twoFactorEnabled: false', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ user: { twoFactorEnabled: false } })),
    );

    renderProtectedLayout();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/enrol', { replace: true });
    });

    expect(navigateMock).not.toHaveBeenCalledWith('/sign-in', { replace: true });
  });

  it('redirects to /enrol when GET /api/auth/get-session returns 403 with MFA_REQUIRED', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ code: 'MFA_REQUIRED', enrolmentUrl: '/api/auth/two-factor/enable' }, 403),
      ),
    );

    renderProtectedLayout();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/enrol', { replace: true });
    });
  });

  it('redirects to /sign-in when a re-auth CustomEvent is dispatched', async () => {
    // Session is valid so layout stays rendered; then a re-auth event fires
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ user: { twoFactorEnabled: true } })),
    );

    renderProtectedLayout();

    // Wait for the session to be resolved and the outlet to render
    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });

    // Dispatch re-auth event (as the QueryClient would on 401)
    window.dispatchEvent(new CustomEvent('re-auth'));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/sign-in', { replace: true });
    });
  });

  it('renders <Outlet /> when session is valid and twoFactorEnabled: true', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ user: { twoFactorEnabled: true } })),
    );

    renderProtectedLayout();

    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows the asp brand link for all roles', async () => {
    mockSessionAndMe(['applicant']);

    renderProtectedLayout();

    const brandLink = await screen.findByRole('link', { name: 'asp' });
    expect(brandLink).toHaveAttribute('href', '/');
  });

  it('shows an Experiences nav link for an applicant/mentor (non-admin)', async () => {
    mockSessionAndMe(['applicant']);

    renderProtectedLayout();

    const link = await screen.findByRole('link', { name: 'Experiences' });
    expect(link).toHaveAttribute('href', '/experiences');
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows Admin and Experiences nav links for an admin', async () => {
    mockSessionAndMe(['admin']);

    renderProtectedLayout();

    const adminLink = await screen.findByRole('link', { name: 'Admin' });
    expect(adminLink).toHaveAttribute('href', '/admin');

    const experiencesLink = screen.getByRole('link', { name: 'Experiences' });
    expect(experiencesLink).toHaveAttribute('href', '/experiences');
  });

  it('shows the asp brand link for an admin', async () => {
    mockSessionAndMe(['admin']);

    renderProtectedLayout();

    const brandLink = await screen.findByRole('link', { name: 'asp' });
    expect(brandLink).toHaveAttribute('href', '/');
  });

  it('shows a "Mentor workspace" link when hasMentorGrants is true', async () => {
    mockSessionAndMe(['applicant'], true);

    renderProtectedLayout();

    const link = await screen.findByRole('link', { name: 'Mentor workspace' });
    expect(link).toHaveAttribute('href', '/mentor');
  });

  it('does not show a "Mentor workspace" link when hasMentorGrants is false', async () => {
    mockSessionAndMe(['applicant'], false);

    renderProtectedLayout();

    // Wait for the header to render (Experiences link is always present for a non-admin).
    await screen.findByRole('link', { name: 'Experiences' });
    expect(screen.queryByRole('link', { name: 'Mentor workspace' })).not.toBeInTheDocument();
  });

  it('renders a sign-out button that posts to /api/auth/sign-out then navigates to /sign-in', async () => {
    mockSessionAndMe(['applicant']);

    renderProtectedLayout();

    const button = await screen.findByRole('button', { name: 'Sign out' });
    button.click();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/sign-in', { replace: true });
    });
  });
});
