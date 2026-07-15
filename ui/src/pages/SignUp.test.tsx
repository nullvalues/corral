import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignUp } from './SignUp.js';

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

function renderSignUp() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SignUp />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SignUp', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders email input, password input, and submit button', () => {
    renderSignUp();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });

  it('calls navigate("/enrol") with password state on successful sign-up', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: '1', email: 'test@example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderSignUp();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign up/i }).closest('form')!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/enrol', { state: { password: 'password123' } });
    });
  });

  it('displays error message on 409 conflict', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Email already taken' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderSignUp();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'taken@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign up/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Email already taken');
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('displays fallback error message when server returns no message', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('not json', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    renderSignUp();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign up/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sign-up failed');
    });
  });
});
