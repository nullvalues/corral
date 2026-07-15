import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResetPassword } from './ResetPassword.js';

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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderResetPassword(search = '?token=abc123') {
  // jsdom does not reflect MemoryRouter state into window.location.search,
  // so we stub window.location.search directly.
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, search },
  });

  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ResetPassword', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('when no token in URL', () => {
    it('shows "Invalid or missing reset link" error', () => {
      renderResetPassword('');
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid or missing reset link');
    });

    it('shows link to /forgot-password', () => {
      renderResetPassword('');
      const link = screen.getByRole('link', { name: /request a new reset link/i });
      expect(link).toBeInTheDocument();
    });

    it('does not render password fields', () => {
      renderResetPassword('');
      expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    });
  });

  describe('when token is present', () => {
    it('renders new password and confirm password fields', () => {
      renderResetPassword('?token=abc123');
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    });

    it('renders submit button', () => {
      renderResetPassword('?token=abc123');
      expect(screen.getByRole('button', { name: /set new password/i })).toBeInTheDocument();
    });

    it('shows client-side error when passwords do not match (no fetch call)', async () => {
      renderResetPassword('?token=abc123');

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'different99' },
      });
      fireEvent.submit(screen.getByRole('button', { name: /set new password/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });

      expect(fetch).not.toHaveBeenCalled();
    });

    it('shows client-side error when password is too short', async () => {
      renderResetPassword('?token=abc123');

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'short' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'short' },
      });
      fireEvent.submit(screen.getByRole('button', { name: /set new password/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/string must contain at least 8 character/i)).toBeInTheDocument();
      });

      expect(fetch).not.toHaveBeenCalled();
    });

    it('calls POST /api/auth/reset-password with token and newPassword only', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      renderResetPassword('?token=abc123');

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.submit(screen.getByRole('button', { name: /set new password/i }).closest('form')!);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/auth/reset-password',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'abc123', newPassword: 'newpassword1' }),
          }),
        );
      });
    });

    it('navigates to /sign-in with state message on success', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      renderResetPassword('?token=abc123');

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.submit(screen.getByRole('button', { name: /set new password/i }).closest('form')!);

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith('/sign-in', {
          state: { message: 'Password updated' },
        });
      });
    });

    it('shows expired/invalid error on non-200 response', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ message: 'Token expired' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      renderResetPassword('?token=expiredtoken');

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.submit(screen.getByRole('button', { name: /set new password/i }).closest('form')!);

      await waitFor(() => {
        expect(
          screen.getByText(/this reset link has expired or is invalid/i),
        ).toBeInTheDocument();
      });

      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('shows link to /forgot-password in expired error', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      renderResetPassword('?token=expiredtoken');

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.submit(screen.getByRole('button', { name: /set new password/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      const link = screen.getByRole('link', { name: /request a new one/i });
      expect(link).toBeInTheDocument();
    });

    it('disables submit button while pending', async () => {
      let resolveFetch!: (value: Response) => void;
      vi.mocked(fetch).mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
      );

      renderResetPassword('?token=abc123');

      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'newpassword1' },
      });
      fireEvent.submit(screen.getByRole('button', { name: /set new password/i }).closest('form')!);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
      });

      act(() => {
        resolveFetch(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });
    });
  });
});

describe('SignIn banner — Password updated', () => {
  // Import SignIn separately to test the banner integration
  it('shows success message when location.state.message is set', async () => {
    const { SignIn } = await import('./SignIn.js');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/sign-in', state: { message: 'Password updated' } }]}>
          <SignIn />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Password updated');
    cleanup();
  });

  it('clears message on user input', async () => {
    const { SignIn } = await import('./SignIn.js');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/sign-in', state: { message: 'Password updated' } }]}>
          <SignIn />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'x' } });

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    cleanup();
  });

  it('clears message after 4s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { SignIn } = await import('./SignIn.js');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/sign-in', state: { message: 'Password updated' } }]}>
          <SignIn />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4001);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    vi.useRealTimers();
    cleanup();
  }, 10000);
});
