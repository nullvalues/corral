import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { SignIn } from './SignIn.js';

// Mock react-router-dom's useNavigate
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

/**
 * Build a QueryClient with the same MutationCache re-auth wiring as the
 * production queryClient (UI-002) so the 401 → re-auth event test works.
 */
function dispatch401(error: unknown): void {
  if (
    error != null &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: unknown }).status === 401
  ) {
    window.dispatchEvent(new CustomEvent('re-auth'));
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({ onError: dispatch401 }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderSignIn() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SignIn />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SignIn', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders email input, password input, and submit button', () => {
    renderSignIn();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls navigate("/") on successful sign-in', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: 'abc', user: { id: '1', email: 'test@example.com' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderSignIn();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/');
    });
  });

  it('displays error message and fires re-auth event on 401', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid email or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const events: Event[] = [];
    const handler = (e: Event) => events.push(e);
    window.addEventListener('re-auth', handler);

    renderSignIn();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'wrong@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrongpassword' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
    });

    window.removeEventListener('re-auth', handler);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(CustomEvent);
    expect((events[0] as CustomEvent).type).toBe('re-auth');
  });

  it('displays fallback error message when server returns no message', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('not json', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    renderSignIn();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed');
    });
  });
});
