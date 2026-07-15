import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TotpChallenge } from './TotpChallenge.js';

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

function renderTotpChallenge() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TotpChallenge />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TotpChallenge', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders no alert and issues no enable call on mount', () => {
    renderTotpChallenge();

    // No error surfaced before any submit.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // No fetch at all on mount — and specifically never the enable path.
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(String(call[0])).not.toContain('two-factor/enable');
    }
  });

  it('renders the #totp-code input and Verify button, no QR code', () => {
    renderTotpChallenge();

    const input = screen.getByLabelText(/authentication code/i);
    expect(input).toBeInTheDocument();
    expect(input.id).toBe('totp-code');
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
  });

  it('posts the entered code to verify-totp and navigates on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpChallenge();

    fireEvent.change(screen.getByLabelText(/authentication code/i), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: /verify/i }).closest('form')!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/');
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/two-factor/verify-totp',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ code: '123456' }),
      }),
    );
  });

  it('renders a role="alert" with the server message on failed verify', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Invalid TOTP code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpChallenge();

    fireEvent.change(screen.getByLabelText(/authentication code/i), { target: { value: '000000' } });
    fireEvent.submit(screen.getByRole('button', { name: /verify/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid TOTP code');
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
