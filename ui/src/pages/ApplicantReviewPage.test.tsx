import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApplicantReviewPage } from './ApplicantReviewPage.js';
import { MentorContext } from '../layouts/MentorScopeLayout.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APPLICANT_ID = 'applicant-001';
const APPLICANT_NAME = 'Jane Applicant';

const MENTOR_CTX = {
  grant: {
    applicantUserId: APPLICANT_ID,
    applicantName: APPLICANT_NAME,
    permissions: ['write'],
  },
};

const CATEGORIES = [
  {
    id: 'cat-hc',
    slug: 'healthcare-experience',
    name: 'Healthcare Experience',
    isActive: true,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-emp',
    slug: 'employment',
    name: 'Employment',
    isActive: true,
    sortOrder: 2,
    createdAt: '2024-01-01T00:00:00Z',
  },
];

const ROLLUP = [
  {
    categoryId: 'cat-hc',
    categorySlug: 'healthcare-experience',
    categoryName: 'Healthcare Experience',
    totalHours: 200,
  },
];

// Two experiences: one verified, one pending
const EXPERIENCES = [
  {
    id: 'exp-verified',
    categoryId: 'cat-hc',
    organization: 'City Hospital',
    position: 'Volunteer',
    verificationStatus: 'verified' as const,
    verifiedAt: '2024-03-15T10:00:00Z',
    totalHours: 100,
    hoursPerWeek: 10,
    numberOfWeeks: 10,
    startDate: '2024-01-01',
    endDate: '2024-03-01',
    dutiesNarrative: 'Assisted nurses.',
    isVolunteer: true,
    isCurrent: false,
    receivedAcademicCredit: false,
    receivedSalaryOrPayment: false,
    isMostImportant: false,
    permissionToContact: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'exp-pending',
    categoryId: 'cat-hc',
    organization: 'Clinic A',
    position: 'Intern',
    verificationStatus: 'unverified' as const,
    verifiedAt: null,
    totalHours: 100,
    hoursPerWeek: 10,
    numberOfWeeks: 10,
    startDate: '2024-02-01',
    endDate: '2024-04-01',
    dutiesNarrative: 'Shadowed doctors.',
    isVolunteer: false,
    isCurrent: false,
    receivedAcademicCredit: false,
    receivedSalaryOrPayment: false,
    isMostImportant: false,
    permissionToContact: false,
    createdAt: '2024-02-01T00:00:00Z',
    updatedAt: '2024-02-01T00:00:00Z',
  },
  {
    id: 'exp-emp',
    categoryId: 'cat-emp',
    organization: 'Retail Co',
    position: 'Cashier',
    verificationStatus: 'unverified' as const,
    verifiedAt: null,
    totalHours: 50,
    hoursPerWeek: 5,
    numberOfWeeks: 10,
    startDate: '2024-03-01',
    endDate: '2024-05-01',
    dutiesNarrative: 'Handled register and inventory.',
    isVolunteer: false,
    isCurrent: false,
    receivedAcademicCredit: false,
    receivedSalaryOrPayment: true,
    isMostImportant: false,
    permissionToContact: false,
    createdAt: '2024-03-01T00:00:00Z',
    updatedAt: '2024-03-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mutate = vi.fn();

vi.mock('../hooks/useVerifyExperience.js', () => ({
  useVerifyExperience: () => ({ mutate }),
}));

function makeQueryClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  qc.setQueryData(['experiences', APPLICANT_ID], EXPERIENCES);
  qc.setQueryData(['rollup', APPLICANT_ID], ROLLUP);
  qc.setQueryData(['categories'], CATEGORIES);

  return qc;
}

const POPULATED_PROFILE = {
  name: APPLICANT_NAME,
  school: 'State University',
  graduationYear: 2025,
  bio: 'Aspiring veterinarian.',
  major: 'Animal Science',
  linkedinUrl: 'https://linkedin.com/in/jane',
  portfolioUrl: 'https://jane.example.com',
};

const NULL_PROFILE = {
  name: APPLICANT_NAME,
  school: null,
  graduationYear: null,
  bio: null,
  major: null,
  linkedinUrl: null,
  portfolioUrl: null,
};

function stubFetch(
  profile: unknown,
  resumeStatus: number = 404,
  resumeBody: object = { error: 'Not found' },
): ReturnType<typeof vi.fn> {
  const fn = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/resume')) {
      return Promise.resolve(
        new Response(JSON.stringify(resumeBody), {
          status: resumeStatus,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    const body =
      url.includes('/profile') && profile !== undefined
        ? JSON.stringify(profile)
        : '[]';
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage(
  profile?: unknown,
  resumeStatus: number = 404,
  resumeBody: object = { error: 'Not found' },
) {
  const fetchFn = stubFetch(profile, resumeStatus, resumeBody);

  const qc = makeQueryClient();

  return {
    fetchFn,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/mentor/${APPLICANT_ID}`]}>
          <Routes>
            <Route
              path="/mentor/:applicantUserId"
              element={
                <MentorContext.Provider value={MENTOR_CTX}>
                  <ApplicantReviewPage />
                </MentorContext.Provider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApplicantReviewPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mutate.mockReset();
  });

  it('renders the readiness ring in the left panel', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('readiness-ring')).toBeInTheDocument();
    });
  });

  it('renders the applicant name in the left panel', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('applicant-name')).toHaveTextContent(APPLICANT_NAME);
    });
  });

  it('banner shows "X of Y verified" matching the mocked counts', async () => {
    renderPage();
    // 1 verified out of 3 total
    await waitFor(() => {
      expect(screen.getByTestId('banner-count')).toHaveTextContent('1 of 3 verified');
    });
  });

  it('pending row shows Verify button and Flag button', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('verify-btn-exp-pending')).toBeInTheDocument();
      expect(screen.getByTestId('flag-btn-exp-pending')).toBeInTheDocument();
    });
  });

  it('clicking Verify calls the mutation with { id, action: "verify" }', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('verify-btn-exp-pending')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('verify-btn-exp-pending'));
    expect(mutate).toHaveBeenCalledWith({ id: 'exp-pending', action: 'verify' });
  });

  it('verified row shows "Verified by you" treatment', async () => {
    renderPage();
    await waitFor(() => {
      const row = screen.getByTestId('verified-row-exp-verified');
      expect(row).toHaveTextContent('Verified by you');
    });
  });

  it('verified row does NOT show a Verify button', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('verify-btn-exp-verified')).not.toBeInTheDocument();
    });
  });

  it('renders a populated profile card with school, major, grad year, bio and both links', async () => {
    renderPage(POPULATED_PROFILE);
    await waitFor(() => {
      expect(screen.getByTestId('profile-school')).toHaveTextContent('State University');
    });
    expect(screen.getByTestId('profile-major')).toHaveTextContent('Animal Science');
    expect(screen.getByTestId('profile-graduation-year')).toHaveTextContent('2025');
    expect(screen.getByTestId('profile-bio')).toHaveTextContent('Aspiring veterinarian.');

    const linkedin = screen.getByTestId('profile-linkedin');
    expect(linkedin).toHaveAttribute('href', 'https://linkedin.com/in/jane');
    expect(linkedin).toHaveAttribute('target', '_blank');
    expect(linkedin).toHaveAttribute('rel', 'noopener noreferrer');

    const portfolio = screen.getByTestId('profile-portfolio');
    expect(portfolio).toHaveAttribute('href', 'https://jane.example.com');
    expect(portfolio).toHaveAttribute('target', '_blank');
    expect(portfolio).toHaveAttribute('rel', 'noopener noreferrer');

    expect(screen.queryByTestId('profile-empty')).not.toBeInTheDocument();
  });

  it('renders "No profile information provided" for an all-null profile', async () => {
    renderPage(NULL_PROFILE);
    await waitFor(() => {
      expect(screen.getByTestId('profile-empty')).toHaveTextContent(
        'No profile information provided',
      );
    });
    expect(screen.queryByTestId('profile-school')).not.toBeInTheDocument();
  });

  it('omits individual null fields without blank labels', async () => {
    renderPage({
      ...NULL_PROFILE,
      school: 'State University',
      major: null,
      linkedinUrl: null,
    });
    await waitFor(() => {
      expect(screen.getByTestId('profile-school')).toHaveTextContent('State University');
    });
    expect(screen.queryByTestId('profile-major')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-linkedin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-empty')).not.toBeInTheDocument();
  });

  it('issues the profile request against the mentor-scoped endpoint (not /api/me/profile)', async () => {
    const { fetchFn } = renderPage(POPULATED_PROFILE);
    await waitFor(() => {
      expect(screen.getByTestId('profile-school')).toBeInTheDocument();
    });
    const calledUrls = fetchFn.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : String(c[0]),
    );
    expect(
      calledUrls.some((u) =>
        u.includes(`/api/mentor/applicants/${APPLICANT_ID}/profile`),
      ),
    ).toBe(true);
    expect(calledUrls.some((u) => u.includes('/api/me/profile'))).toBe(false);
  });

  // ── API-066: ProfileLink scheme guard ────────────────────────────────────

  it('ProfileLink: does not render an <a> when linkedinUrl has a javascript: scheme', async () => {
    renderPage({ ...NULL_PROFILE, linkedinUrl: 'javascript:alert(1)' });
    // The linkedin dd should exist but contain no anchor
    await waitFor(() => {
      // profile-linkedin data-testid is on the <a> — it must not be in the DOM
      expect(screen.queryByTestId('profile-linkedin')).not.toBeInTheDocument();
    });
  });

  it('ProfileLink: renders the <a> when linkedinUrl has a valid https:// scheme', async () => {
    renderPage({ ...NULL_PROFILE, linkedinUrl: 'https://linkedin.com/in/foo' });
    await waitFor(() => {
      const link = screen.getByTestId('profile-linkedin');
      expect(link).toHaveAttribute('href', 'https://linkedin.com/in/foo');
    });
  });

  // ── UI-101: flag modal ────────────────────────────────────────────────────

  const FLAG_ROW = {
    id: '11111111-1111-4111-8111-111111111111',
    reviewerUserId: 'mentor-001',
    experienceId: 'exp-pending',
    reason: 'Hours look inflated',
    status: 'open',
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: '2026-07-01T00:00:00Z',
  };

  /** Re-stubs fetch so the flag POST returns the given status. */
  function stubFlagFetch(status: number): ReturnType<typeof vi.fn> {
    const fn = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/flag')) {
        return Promise.resolve(
          new Response(
            status === 201 ? JSON.stringify(FLAG_ROW) : JSON.stringify({ error: 'Forbidden' }),
            { status, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('clicking the Flag button opens the flag modal with a reason textarea', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('flag-btn-exp-pending')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flag-btn-exp-pending'));
    expect(screen.getByTestId('flag-reason-input')).toBeInTheDocument();
    expect(screen.getByTestId('flag-submit-btn')).toBeInTheDocument();
  });

  it('submitting the flag modal POSTs the entered reason and shows the success state', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('flag-btn-exp-pending')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flag-btn-exp-pending'));

    fireEvent.change(screen.getByTestId('flag-reason-input'), {
      target: { value: 'Hours look inflated' },
    });

    const flagFetch = stubFlagFetch(201);
    fireEvent.click(screen.getByTestId('flag-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('flag-success')).toBeInTheDocument();
    });

    const flagCall = flagFetch.mock.calls.find((c) =>
      String(c[0]).includes('/api/experiences/exp-pending/flag'),
    );
    expect(flagCall).toBeDefined();
    const init = flagCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Hours look inflated' });
  });

  it('a failed flag POST shows the inline error state', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('flag-btn-exp-pending')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flag-btn-exp-pending'));

    fireEvent.change(screen.getByTestId('flag-reason-input'), {
      target: { value: 'Suspicious' },
    });

    stubFlagFetch(403);
    fireEvent.click(screen.getByTestId('flag-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('flag-error')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('flag-success')).not.toBeInTheDocument();
  });

  it('the flag submit button is disabled while the reason is empty', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('flag-btn-exp-pending')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flag-btn-exp-pending'));
    expect(screen.getByTestId('flag-submit-btn')).toBeDisabled();
  });

  // ── UI-102: search + status filter ──────────────────────────────────────

  async function waitForRows(): Promise<void> {
    await waitFor(() => {
      expect(screen.getByTestId('pending-row-exp-pending')).toBeInTheDocument();
    });
  }

  it('typing a search term matching an organization narrows the list (case-insensitive)', async () => {
    renderPage();
    await waitForRows();

    fireEvent.change(screen.getByTestId('experience-search-input'), {
      target: { value: 'city hospital' },
    });

    expect(screen.getByTestId('verified-row-exp-verified')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-row-exp-pending')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-row-exp-emp')).not.toBeInTheDocument();
  });

  it('search matches on position', async () => {
    renderPage();
    await waitForRows();

    fireEvent.change(screen.getByTestId('experience-search-input'), {
      target: { value: 'CASHIER' },
    });

    expect(screen.getByTestId('pending-row-exp-emp')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-row-exp-pending')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verified-row-exp-verified')).not.toBeInTheDocument();
  });

  it('search matches on dutiesNarrative', async () => {
    renderPage();
    await waitForRows();

    fireEvent.change(screen.getByTestId('experience-search-input'), {
      target: { value: 'shadowed' },
    });

    expect(screen.getByTestId('pending-row-exp-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('verified-row-exp-verified')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-row-exp-emp')).not.toBeInTheDocument();
  });

  it('status toggle "Unverified" shows only unverified experiences', async () => {
    renderPage();
    await waitForRows();

    fireEvent.click(screen.getByTestId('status-filter-unverified'));

    expect(screen.getByTestId('pending-row-exp-pending')).toBeInTheDocument();
    expect(screen.getByTestId('pending-row-exp-emp')).toBeInTheDocument();
    expect(screen.queryByTestId('verified-row-exp-verified')).not.toBeInTheDocument();
  });

  it('status toggle "Verified" shows only verified experiences and hides empty categories', async () => {
    renderPage();
    await waitForRows();

    fireEvent.click(screen.getByTestId('status-filter-verified'));

    expect(screen.getByTestId('verified-row-exp-verified')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-row-exp-pending')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-row-exp-emp')).not.toBeInTheDocument();
    // The Employment category now has no matching experiences — section hidden
    expect(
      screen.queryByTestId('category-section-employment'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('category-section-healthcare-experience'),
    ).toBeInTheDocument();
  });

  it('status toggle "All" restores the full list after filtering', async () => {
    renderPage();
    await waitForRows();

    fireEvent.click(screen.getByTestId('status-filter-verified'));
    expect(screen.queryByTestId('pending-row-exp-pending')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('status-filter-all'));
    expect(screen.getByTestId('pending-row-exp-pending')).toBeInTheDocument();
    expect(screen.getByTestId('pending-row-exp-emp')).toBeInTheDocument();
    expect(screen.getByTestId('verified-row-exp-verified')).toBeInTheDocument();
  });

  it('combined search + status filter intersects correctly', async () => {
    renderPage();
    await waitForRows();

    // "i" would match all three; restrict to unverified in cat-hc via search
    fireEvent.change(screen.getByTestId('experience-search-input'), {
      target: { value: 'clinic' },
    });
    fireEvent.click(screen.getByTestId('status-filter-verified'));

    // Clinic A is unverified — verified filter + clinic search = no matches
    expect(screen.queryByTestId('pending-row-exp-pending')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verified-row-exp-verified')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-row-exp-emp')).not.toBeInTheDocument();

    // Switch to unverified: Clinic A matches both filters
    fireEvent.click(screen.getByTestId('status-filter-unverified'));
    expect(screen.getByTestId('pending-row-exp-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('verified-row-exp-verified')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-row-exp-emp')).not.toBeInTheDocument();
  });

  // ── UI-109: mentor resume link ───────────────────────────────────────────

  it('renders a "View resume" link when GET /api/mentor/applicants/:id/resume returns 200', async () => {
    renderPage(
      NULL_PROFILE,
      200,
      { url: 'https://s3.example.com/resumes/applicant-001.pdf?token=abc' },
    );
    const link = await screen.findByTestId('applicant-resume-link') as HTMLAnchorElement;
    expect(link).toHaveTextContent('View resume');
    expect(link).toHaveAttribute('href', 'https://s3.example.com/resumes/applicant-001.pdf?token=abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders no resume link and no error when GET /api/mentor/applicants/:id/resume returns 404', async () => {
    renderPage(NULL_PROFILE, 404, { error: 'Not found' });
    await waitFor(() => {
      expect(screen.getByTestId('profile-card')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('applicant-resume-link')).not.toBeInTheDocument();
  });

  it('renders no resume link when GET /api/mentor/applicants/:id/resume returns 403', async () => {
    renderPage(NULL_PROFILE, 403, { error: 'Forbidden' });
    await waitFor(() => {
      expect(screen.getByTestId('profile-card')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('applicant-resume-link')).not.toBeInTheDocument();
  });
});
