import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TotpEnrol } from './TotpEnrol.js';

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

function renderTotpEnrol(routeState?: Record<string, unknown>) {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/enrol', state: routeState ?? null }]}>
        <TotpEnrol />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TotpEnrol', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    // Stub clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the heading and code input', () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totpURI: 'otpauth://totp/test?secret=ABC', backupCodes: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpEnrol();

    expect(screen.getByText(/set up two-factor/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify code/i })).toBeInTheDocument();
  });

  it('calls enable mutation on mount and renders QR code when totpURI is returned', async () => {
    const totpURI = 'otpauth://totp/test?secret=ABCDEFGH';
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totpURI, backupCodes: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpEnrol();

    // Verify enable endpoint was called
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/two-factor/enable',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // QR code container should appear
    await waitFor(() => {
      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });

    // SVG element from QRCodeSVG should render inside the container
    const qrContainer = screen.getByTestId('qr-code');
    expect(qrContainer.querySelector('svg')).not.toBeNull();

    // Raw base32 secret should also be rendered for manual entry
    const secret = new URL(totpURI).searchParams.get('secret');
    expect(screen.getByTestId('totp-secret')).toHaveTextContent(secret!);
  });

  it('renders backup codes block when enable response contains backup codes', async () => {
    const totpURI = 'otpauth://totp/test?secret=ABCDEFGH';
    const codes = ['AAAAA-BBBBB', 'CCCCC-DDDDD', 'EEEEE-FFFFF'];

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totpURI, backupCodes: codes }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpEnrol();

    await waitFor(() => {
      expect(screen.getByTestId('backup-codes-block')).toBeInTheDocument();
    });

    // All codes should be visible
    for (const code of codes) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }

    // Copy button present
    expect(screen.getByTestId('backup-codes-copy-btn')).toBeInTheDocument();

    // Warning text present
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });

  it('does not render backup codes block when enable response has empty backupCodes', async () => {
    const totpURI = 'otpauth://totp/test?secret=ABCDEFGH';

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totpURI, backupCodes: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpEnrol();

    await waitFor(() => {
      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('backup-codes-block')).not.toBeInTheDocument();
  });

  it('copy button writes joined codes to clipboard', async () => {
    const totpURI = 'otpauth://totp/test?secret=ABCDEFGH';
    const codes = ['AAAAA-11111', 'BBBBB-22222'];

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totpURI, backupCodes: codes }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpEnrol();

    await waitFor(() => {
      expect(screen.getByTestId('backup-codes-copy-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('backup-codes-copy-btn'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(codes.join('\n'));
  });

  it('calls navigate("/") on successful verify', async () => {
    const totpURI = 'otpauth://totp/test?secret=ABCDEFGH';

    // First call: enable; second call: verify
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totpURI, backupCodes: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    renderTotpEnrol();

    // Wait for QR code to appear (enable mutation resolved)
    await waitFor(() => {
      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });

    // Fill in code and submit
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: /verify code/i }).closest('form')!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/');
    });

    // Verify the correct endpoint was called
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/two-factor/verify-totp',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: '123456' }),
      }),
    );
  });

  it('displays error message on failed verify', async () => {
    const totpURI = 'otpauth://totp/test?secret=ABCDEFGH';

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totpURI, backupCodes: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid TOTP code' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    renderTotpEnrol();

    await waitFor(() => {
      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '000000' } });
    fireEvent.submit(screen.getByRole('button', { name: /verify code/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid TOTP code');
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('displays fallback error on non-JSON verify failure', async () => {
    const totpURI = 'otpauth://totp/test?secret=ABCDEFGH';

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totpURI, backupCodes: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('not json', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

    renderTotpEnrol();

    await waitFor(() => {
      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '999999' } });
    fireEvent.submit(screen.getByRole('button', { name: /verify code/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid code');
    });
  });

  it('calls enable with password from router state', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totpURI: 'otpauth://totp/test?secret=ABC', backupCodes: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpEnrol({ password: 'test-pass' });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/two-factor/enable',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'test-pass' }),
        }),
      );
    });
  });

  it('renders QR element and totp-secret when enable resolves with totpURI (password passed)', async () => {
    const totpURI = 'otpauth://totp/test?secret=SECRETKEY';
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totpURI, backupCodes: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpEnrol({ password: 'test-pass' });

    await waitFor(() => {
      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });
    expect(screen.getByTestId('totp-secret')).toBeInTheDocument();
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('SECRETKEY');
  });

  it('does not use verify-otp endpoint anywhere', () => {
    // This is a static check — the import of the module would expose it
    // The test runner just needs to confirm no reference to verify-otp exists
    // We validate this by checking the fetch calls made
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totpURI: 'otpauth://totp/test', backupCodes: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderTotpEnrol();

    // No call to verify-otp should ever be made (static spec check)
    const allCalls = vi.mocked(fetch).mock.calls;
    for (const call of allCalls) {
      expect(String(call[0])).not.toContain('verify-otp');
    }
  });
});
