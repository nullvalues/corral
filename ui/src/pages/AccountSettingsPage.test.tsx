import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AccountSettingsPage } from './AccountSettingsPage.js';

// Mock useNavigate
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function makeQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderPage(qc?: QueryClient) {
  const client = qc ?? makeQc();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Stub fetch so session/sessions queries don't hang
function stubFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      for (const [pattern, body] of Object.entries(overrides)) {
        if (url.includes(pattern)) {
          return Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
      }
      // Default: 200 with empty object
      return Promise.resolve(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    }),
  );
}

describe('AccountSettingsPage — Change password', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    navigateMock.mockReset();
  });

  it('shows password mismatch error and does not submit when passwords differ', async () => {
    stubFetch();
    const fetchMock = vi.mocked(fetch);

    renderPage();

    // Fill current password
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'oldPassword1' },
    });
    // Fill new password
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'newPassword1' },
    });
    // Fill mismatched confirm
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'differentPassword' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByTestId('cp-confirm-error')).toHaveTextContent(
      'Passwords do not match',
    );

    // The change-password POST should not have been called
    const callUrls = fetchMock.mock.calls.map(([url]) =>
      typeof url === 'string' ? url : (url as Request).url,
    );
    expect(callUrls.some((u) => u.includes('/api/auth/change-password'))).toBe(false);
  });

  it('submits when passwords match and shows success message', async () => {
    stubFetch({
      'change-password': {},
    });

    renderPage();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'oldPassword1' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'newPassword1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newPassword1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByTestId('cp-success')).toBeInTheDocument();
  });

  it('shows server error message when change-password call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('change-password')) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Wrong password' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );
      }),
    );

    renderPage();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrongPassword' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'newPassword1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newPassword1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByTestId('cp-server-error')).toBeInTheDocument();
  });
});

describe('AccountSettingsPage — Active sessions', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    navigateMock.mockReset();
  });

  const SESSIONS = [
    {
      id: 'sess-1',
      token: 'tok-1',
      userAgent: 'Mozilla/5.0 (Test Browser)',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sess-2',
      token: 'tok-2',
      userAgent: 'Chrome/100',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];

  it('renders sessions from a mocked list-sessions response', async () => {
    stubFetch({
      'list-sessions': { sessions: SESSIONS },
    });

    renderPage();

    expect(await screen.findByText('Mozilla/5.0 (Test Browser)')).toBeInTheDocument();
    expect(screen.getByText('Chrome/100')).toBeInTheDocument();
  });

  it('clicking Revoke fires POST /api/auth/revoke-session with the correct token', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('list-sessions')) {
        return Promise.resolve(
          new Response(JSON.stringify({ sessions: SESSIONS }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    // Wait for sessions to render
    await screen.findByText('Mozilla/5.0 (Test Browser)');

    // Both sessions have Revoke buttons (no "current token" match since get-session returns {})
    const revokeBtn = screen.getByTestId('revoke-session-sess-1');
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      const revokeCalls = fetchMock.mock.calls.filter((args) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
        return url.includes('revoke-session') && !url.includes('revoke-other-sessions');
      });
      expect(revokeCalls.length).toBeGreaterThan(0);
      const [, opts] = revokeCalls[0] as [string, RequestInit];
      expect(opts?.method).toBe('POST');
    });
  });

  it('clicking "Revoke all other sessions" fires POST /api/auth/revoke-other-sessions', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('list-sessions')) {
        return Promise.resolve(
          new Response(JSON.stringify({ sessions: SESSIONS }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await screen.findByText('Mozilla/5.0 (Test Browser)');

    const revokeAllBtn = screen.getByTestId('revoke-all-btn');
    fireEvent.click(revokeAllBtn);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((args) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
        return url.includes('revoke-other-sessions');
      });
      expect(calls.length).toBeGreaterThan(0);
      const [, opts] = calls[0] as [string, RequestInit];
      expect(opts?.method).toBe('POST');
    });
  });
});

describe('AccountSettingsPage — Delete account', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    navigateMock.mockReset();
  });

  it('shows confirmation panel on first click (does not call delete-user yet)', async () => {
    stubFetch();
    const fetchMock = vi.mocked(fetch);

    renderPage();

    const deleteBtn = screen.getByTestId('delete-account-btn');
    fireEvent.click(deleteBtn);

    expect(screen.getByTestId('delete-confirm-panel')).toBeInTheDocument();

    // delete-user should NOT have been called yet
    const callUrls = fetchMock.mock.calls.map(([url]) =>
      typeof url === 'string' ? url : (url as Request).url,
    );
    expect(callUrls.some((u) => u.includes('delete-user'))).toBe(false);
  });

  it('calls POST /api/auth/delete-user with password and POST /api/auth/sign-out, then navigates to /sign-in', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('delete-user') || url.includes('sign-out')) {
        return Promise.resolve(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );
      }
      return Promise.resolve(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    // First click — shows confirm panel
    fireEvent.click(screen.getByTestId('delete-account-btn'));

    // Enter password
    fireEvent.change(screen.getByTestId('delete-password-input'), {
      target: { value: 'mypassword123' },
    });

    // Second click — confirms deletion
    fireEvent.click(screen.getByTestId('delete-confirm-yes'));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/sign-in', { replace: true });
    });

    // Verify delete-user was called with POST
    const deleteUserCalls = fetchMock.mock.calls.filter((args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      return url.includes('delete-user');
    });
    expect(deleteUserCalls.length).toBeGreaterThan(0);
    const [, deleteOpts] = deleteUserCalls[0] as [string, RequestInit];
    expect(deleteOpts?.method).toBe('POST');

    // Verify sign-out was called with POST
    const signOutCalls = fetchMock.mock.calls.filter((args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      return url.includes('sign-out');
    });
    expect(signOutCalls.length).toBeGreaterThan(0);
    const [, signOutOpts] = signOutCalls[0] as [string, RequestInit];
    expect(signOutOpts?.method).toBe('POST');
  });

  it('cancel button dismisses the confirmation panel', async () => {
    stubFetch();

    renderPage();

    fireEvent.click(screen.getByTestId('delete-account-btn'));
    expect(screen.getByTestId('delete-confirm-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('delete-confirm-cancel'));
    expect(screen.queryByTestId('delete-confirm-panel')).not.toBeInTheDocument();
  });
});

describe('AccountSettingsPage — Backup codes', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    navigateMock.mockReset();
  });

  it('renders the backup codes section with "Unknown" count', () => {
    stubFetch();
    renderPage();

    expect(screen.getByRole('heading', { name: /backup codes/i })).toBeInTheDocument();
    expect(screen.getByTestId('backup-codes-count')).toHaveTextContent('Unknown');
  });

  it('shows the regenerate form when "Regenerate backup codes" is clicked', async () => {
    stubFetch();
    renderPage();

    fireEvent.click(screen.getByTestId('regen-backup-codes-btn'));

    expect(screen.getByTestId('regen-form')).toBeInTheDocument();
    expect(screen.getByTestId('regen-password-input')).toBeInTheDocument();
  });

  it('cancel button hides the regenerate form', async () => {
    stubFetch();
    renderPage();

    fireEvent.click(screen.getByTestId('regen-backup-codes-btn'));
    expect(screen.getByTestId('regen-form')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('regen-cancel-btn'));
    expect(screen.queryByTestId('regen-form')).not.toBeInTheDocument();
  });

  it('calls POST /api/auth/two-factor/generate-backup-codes via apiFetch and shows new codes', async () => {
    const newCodes = ['AAAAA-11111', 'BBBBB-22222', 'CCCCC-33333'];

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('generate-backup-codes')) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: true, backupCodes: newCodes }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    fireEvent.click(screen.getByTestId('regen-backup-codes-btn'));
    fireEvent.change(screen.getByTestId('regen-password-input'), {
      target: { value: 'mypassword' },
    });
    fireEvent.click(screen.getByTestId('regen-submit-btn'));

    // New codes should render in the backup codes block
    await waitFor(() => {
      expect(screen.getByTestId('backup-codes-block')).toBeInTheDocument();
    });

    for (const code of newCodes) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }

    // Form should be hidden after success
    expect(screen.queryByTestId('regen-form')).not.toBeInTheDocument();

    // Assert it was called with POST via apiFetch (not raw fetch with credentials override)
    const genCalls = fetchMock.mock.calls.filter((args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      return url.includes('generate-backup-codes');
    });
    expect(genCalls.length).toBeGreaterThan(0);
    const [, genOpts] = genCalls[0] as [string, RequestInit];
    expect(genOpts?.method).toBe('POST');
  });

  it('shows error when generate-backup-codes endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('generate-backup-codes')) {
          return Promise.resolve(
            new Response(JSON.stringify({ message: 'Invalid password' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );
      }),
    );

    renderPage();

    fireEvent.click(screen.getByTestId('regen-backup-codes-btn'));
    fireEvent.change(screen.getByTestId('regen-password-input'), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByTestId('regen-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('regen-error')).toHaveTextContent('Invalid password');
    });
  });
});
