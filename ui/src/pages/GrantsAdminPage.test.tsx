import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GrantsAdminPage } from './GrantsAdminPage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRANT_ACTIVE = {
  id: 'grant-1',
  mentorUserId: 'mentor-user-1',
  applicantUserId: 'applicant-user-1',
  permissions: ['read'],
  grantedByUserId: 'admin-user-1',
  grantedAt: '2024-01-01T00:00:00Z',
  status: 'active',
};

const GRANT_REVOKED = {
  id: 'grant-2',
  mentorUserId: 'mentor-user-2',
  applicantUserId: 'applicant-user-2',
  permissions: ['read'],
  grantedByUserId: 'admin-user-1',
  grantedAt: '2024-01-02T00:00:00Z',
  status: 'revoked',
};

const GRANT_PENDING = {
  id: 'grant-pending-1',
  mentorUserId: 'mentor-user-3',
  applicantUserId: 'applicant-user-3',
  permissions: [],
  grantedByUserId: 'applicant-user-3',
  grantedAt: '2024-01-03T00:00:00Z',
  status: 'pending',
  applicantName: 'Charlie Applicant',
  applicantEmail: 'charlie@example.com',
  mentorName: 'Dana Mentor',
  mentorEmail: 'dana@example.com',
};

const USER_MENTOR = {
  id: 'mentor-user-1',
  email: 'mentor@example.com',
  name: 'Alice Mentor',
};

const USER_APPLICANT = {
  id: 'applicant-user-1',
  email: 'applicant@example.com',
  name: 'Bob Applicant',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GrantsAdminPage />
    </QueryClientProvider>,
  );
}

/**
 * Build a fetch mock that returns:
 *  - `pendingGrants` for GET /api/mentor-grants?status=pending
 *  - `allGrants` for GET /api/mentor-grants (no status param)
 *  - `userResults` for GET /api/users
 *  - `patchResponse` for PATCH /api/mentor-grants/:id (when provided)
 */
function makeFetchMock({
  allGrants = [] as unknown[],
  pendingGrants = [] as unknown[],
  userResults = [] as unknown[],
  patchResponse = null as unknown,
} = {}) {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/api/mentor-grants/') && opts?.method === 'PATCH') {
      return Promise.resolve(
        new Response(JSON.stringify(patchResponse ?? {}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (typeof url === 'string' && url.includes('/api/mentor-grants') && url.includes('status=pending')) {
      return Promise.resolve(
        new Response(JSON.stringify(pendingGrants), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (typeof url === 'string' && url.includes('/api/mentor-grants')) {
      return Promise.resolve(
        new Response(JSON.stringify(allGrants), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (typeof url === 'string' && url.includes('/api/users')) {
      return Promise.resolve(
        new Response(JSON.stringify(userResults), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GrantsAdminPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Page structure
  // -------------------------------------------------------------------------

  it('renders the page heading and section headings', async () => {
    vi.stubGlobal('fetch', makeFetchMock());

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('Mentor Grants')).toBeInTheDocument();
      // There are two "Create Grant" texts: the h2 heading and the button; use getAllBy
      expect(screen.getAllByText(/create grant/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/all grants/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Grant list
  // -------------------------------------------------------------------------

  it('renders grants from the API', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ allGrants: [GRANT_ACTIVE] }));

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('mentor-user-1')).toBeInTheDocument();
      expect(screen.getByText('applicant-user-1')).toBeInTheDocument();
      expect(screen.getByText('read')).toBeInTheDocument();
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });

  it('shows empty state message when no grants exist', async () => {
    vi.stubGlobal('fetch', makeFetchMock());

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('No grants yet.')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // User search
  // -------------------------------------------------------------------------

  it('renders Search buttons for mentor and applicant sections', async () => {
    vi.stubGlobal('fetch', makeFetchMock());

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      const searchButtons = screen.getAllByRole('button', { name: /search/i });
      expect(searchButtons.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('user search calls GET /api/users via TanStack Query when Search is clicked', async () => {
    const fetchMock = makeFetchMock({ userResults: [USER_MENTOR] });
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeQueryClient();
    renderPage(qc);

    // Wait for page to render
    await waitFor(() => {
      expect(screen.getByText('Mentor Grants')).toBeInTheDocument();
    });

    // Find the first email input (mentor search)
    const emailInputs = screen.getAllByPlaceholderText('Search by email');
    fireEvent.change(emailInputs[0], { target: { value: 'mentor@example.com' } });

    const searchButtons = screen.getAllByRole('button', { name: /^search$/i });
    fireEvent.click(searchButtons[0]);

    await waitFor(() => {
      const userCalls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/api/users'),
      );
      expect(userCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays search results after typing email and clicking Search', async () => {
    const fetchMock = makeFetchMock({ userResults: [USER_MENTOR] });
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('Mentor Grants')).toBeInTheDocument();
    });

    // Type into the first email input (mentor search) and click Search
    const emailInputs = screen.getAllByPlaceholderText('Search by email');
    fireEvent.change(emailInputs[0], { target: { value: 'mentor@example.com' } });

    const searchButtons = screen.getAllByRole('button', { name: /^search$/i });
    fireEvent.click(searchButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Alice Mentor')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Create button disabled state
  // -------------------------------------------------------------------------

  it('Create Grant button is disabled until mentor, applicant, and permission are selected', async () => {
    vi.stubGlobal('fetch', makeFetchMock());

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      const createGrantButton = screen.getByRole('button', { name: /create grant/i });
      expect(createGrantButton).toBeDisabled();
    });
  });

  it('Create Grant button is enabled when mentor, applicant, and at least one permission are selected', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/users') && url.includes('mentor')) {
        return Promise.resolve(
          new Response(JSON.stringify([USER_MENTOR]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (typeof url === 'string' && url.includes('/api/users') && url.includes('applicant')) {
        return Promise.resolve(
          new Response(JSON.stringify([USER_APPLICANT]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('Mentor Grants')).toBeInTheDocument();
    });

    // Search for mentor
    const emailInputs = screen.getAllByPlaceholderText('Search by email');
    fireEvent.change(emailInputs[0], { target: { value: 'mentor@example.com' } });
    const searchButtons = screen.getAllByRole('button', { name: /^search$/i });
    fireEvent.click(searchButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Alice Mentor')).toBeInTheDocument();
    });

    // Select mentor
    fireEvent.click(screen.getByText('Alice Mentor'));

    // Now search for applicant - inputs shift after mentor is selected (2 search sections still exist)
    await waitFor(() => {
      const inputs = screen.getAllByPlaceholderText('Search by email');
      // After mentor selection, only one input remains (the applicant section)
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    });

    const remainingInputs = screen.getAllByPlaceholderText('Search by email');
    fireEvent.change(remainingInputs[0], { target: { value: 'applicant@example.com' } });
    const remainingSearchBtns = screen.getAllByRole('button', { name: /^search$/i });
    fireEvent.click(remainingSearchBtns[0]);

    await waitFor(() => {
      expect(screen.getByText('Bob Applicant')).toBeInTheDocument();
    });

    // Select applicant
    fireEvent.click(screen.getByText('Bob Applicant'));

    // Check at least one permission
    const readCheckbox = screen.getByRole('checkbox', { name: /read/i });
    fireEvent.click(readCheckbox);

    await waitFor(() => {
      const createGrantButton = screen.getByRole('button', { name: /create grant/i });
      expect(createGrantButton).not.toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // Revocation UI
  // -------------------------------------------------------------------------

  it('active grant shows a Revoke button', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ allGrants: [GRANT_ACTIVE] }));

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument();
    });
  });

  it('revoked grant shows revoked badge and no Revoke button', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ allGrants: [GRANT_REVOKED] }));

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      // "revoked" badge should be visible (there are two: one in status column, one in actions column)
      const revokedBadges = screen.getAllByText('revoked');
      expect(revokedBadges.length).toBeGreaterThanOrEqual(1);
      // No Revoke button
      expect(screen.queryByRole('button', { name: /^revoke$/i })).not.toBeInTheDocument();
    });
  });

  it('clicking Revoke calls PATCH /api/mentor-grants/:id via TanStack mutation', async () => {
    const fetchMock = makeFetchMock({
      allGrants: [GRANT_ACTIVE],
      patchResponse: { ...GRANT_ACTIVE, status: 'revoked' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes('/api/mentor-grants/grant-1') &&
          (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Permissions checkboxes
  // -------------------------------------------------------------------------

  it('renders Read and Write permission checkboxes', async () => {
    vi.stubGlobal('fetch', makeFetchMock());

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /read/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /write/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Pending requests section
  // -------------------------------------------------------------------------

  it('does not render Pending Requests section when there are no pending grants', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ pendingGrants: [] }));

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('Mentor Grants')).toBeInTheDocument();
    });

    expect(screen.queryByText(/pending requests/i)).not.toBeInTheDocument();
  });

  it('renders Pending Requests section when pending grants exist', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ pendingGrants: [GRANT_PENDING] }));

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText(/pending requests/i)).toBeInTheDocument();
      expect(screen.getByText('Charlie Applicant')).toBeInTheDocument();
      expect(screen.getByText('charlie@example.com')).toBeInTheDocument();
      expect(screen.getByText('Dana Mentor')).toBeInTheDocument();
      expect(screen.getByText('dana@example.com')).toBeInTheDocument();
    });
  });

  it('pending section shows Approve and Reject buttons for each pending grant', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ pendingGrants: [GRANT_PENDING] }));

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });
  });

  it('clicking Approve calls PATCH /api/mentor-grants/:id with status active', async () => {
    const fetchMock = makeFetchMock({
      pendingGrants: [GRANT_PENDING],
      patchResponse: { ...GRANT_PENDING, status: 'active' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes(`/api/mentor-grants/${GRANT_PENDING.id}`) &&
          (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCalls.length).toBeGreaterThanOrEqual(1);
      const opts = patchCalls[0][1] as RequestInit;
      const body = JSON.parse(opts.body as string) as { status: string };
      expect(body.status).toBe('active');
    });
  });

  it('clicking Reject calls PATCH /api/mentor-grants/:id with status revoked', async () => {
    const fetchMock = makeFetchMock({
      pendingGrants: [GRANT_PENDING],
      patchResponse: { ...GRANT_PENDING, status: 'revoked' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes(`/api/mentor-grants/${GRANT_PENDING.id}`) &&
          (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCalls.length).toBeGreaterThanOrEqual(1);
      const opts = patchCalls[0][1] as RequestInit;
      const body = JSON.parse(opts.body as string) as { status: string };
      expect(body.status).toBe('revoked');
    });
  });

  it('Pending Requests section appears above the All Grants section', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ pendingGrants: [GRANT_PENDING] }));

    const qc = makeQueryClient();
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText(/pending requests/i)).toBeInTheDocument();
      expect(screen.getByText(/all grants/i)).toBeInTheDocument();
    });

    const pendingHeading = screen.getByText(/pending requests/i);
    const allGrantsHeading = screen.getByText(/all grants/i);

    // compareDocumentPosition: if PENDING comes before ALL GRANTS, ALL GRANTS follows PENDING
    expect(
      pendingHeading.compareDocumentPosition(allGrantsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
