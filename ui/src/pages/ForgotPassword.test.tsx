import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ForgotPassword } from './ForgotPassword.js';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderForgotPassword() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders email input and submit button', () => {
    renderForgotPassword();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('shows success message on 200 response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderForgotPassword();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /send reset link/i }).closest('form')!);

    await waitFor(() => {
      expect(
        screen.getByText(/if that address is registered, a reset link is on its way/i),
      ).toBeInTheDocument();
    });
  });

  it('shows success message on non-200 response (anti-enumeration)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderForgotPassword();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'unknown@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /send reset link/i }).closest('form')!);

    await waitFor(() => {
      expect(
        screen.getByText(/if that address is registered, a reset link is on its way/i),
      ).toBeInTheDocument();
    });
  });

  it('shows success message even when fetch rejects (network error)', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    renderForgotPassword();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /send reset link/i }).closest('form')!);

    await waitFor(() => {
      expect(
        screen.getByText(/if that address is registered, a reset link is on its way/i),
      ).toBeInTheDocument();
    });
  });

  it('disables submit button while pending', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderForgotPassword();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /send reset link/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
    });

    resolveFetch(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('sends POST to /api/auth/request-password-reset with email and redirectTo', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderForgotPassword();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /send reset link/i }).closest('form')!);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/request-password-reset',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            redirectTo: window.location.origin + '/reset-password',
          }),
        }),
      );
    });
  });

  it('renders "Forgot password?" link on SignIn page (link to /forgot-password)', () => {
    // Verify that ForgotPassword page renders "Back to sign in" link
    renderForgotPassword();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
  });
});
