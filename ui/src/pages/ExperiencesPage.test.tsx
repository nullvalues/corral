import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExperiencesPage } from './ExperiencesPage.js';
import { MentorContext } from '../layouts/MentorScopeLayout.js';

// Mock useNavigate so we can assert redirects without full browser routing.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Mock useExperiences so tests can control the returned data without a network call.
// By default returns { data: undefined } so existing cache-seeded tests are unaffected.
const mockUseExperiences = vi.fn().mockReturnValue({ data: undefined });
vi.mock('../hooks/useExperiences.js', () => ({
  useExperiences: (...args: unknown[]) => mockUseExperiences(...args),
}));

const CATEGORY_RESEARCH = {
  id: 'cat-1',
  slug: 'research',
  name: 'Research',
  sortOrder: 1,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
};

const CATEGORY_VOLUNTEER = {
  id: 'cat-2',
  slug: 'volunteer',
  name: 'Volunteer',
  sortOrder: 2,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
};

const CATEGORY_INACTIVE = {
  id: 'cat-3',
  slug: 'inactive-cat',
  name: 'Inactive Category',
  sortOrder: 3,
  isActive: false,
  createdAt: '2024-01-01T00:00:00Z',
};

const ME_APPLICANT = {
  user: { id: 'user-1', email: 'applicant@example.com', name: 'Alice' },
  roles: ['applicant'],
  hasMentorGrants: false,
};

/**
 * Build a fresh QueryClient and optionally pre-populate the experiences cache.
 * Also pre-populate me and applicant grants so fetch is only needed for categories.
 */
function makeQueryClient(options?: {
  experiences?: { id: string; categoryId: string }[];
  grants?: { id: string; status: string }[];
  me?: typeof ME_APPLICANT;
}): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  const { experiences, grants = [], me = ME_APPLICANT } = options ?? {};

  if (experiences) {
    qc.setQueryData(['experiences', 'user-1'], experiences);
  }
  // Pre-populate session cache so useCurrentUserId returns a value
  qc.setQueryData(['session'], { user: { id: 'user-1', twoFactorEnabled: true } });

  // Pre-populate me cache to avoid extra fetch
  qc.setQueryData(['me'], me);

  // Pre-populate applicant grants cache so useMyApplicantGrants reads from cache
  qc.setQueryData(['myApplicantGrants'], grants);

  return qc;
}

/**
 * Render ExperiencesPage inside a minimal router that provides the :slug param.
 * Uses createMemoryRouter so params work without a real browser.
 */
function renderPage(options: {
  slug?: string;
  queryClient: QueryClient;
  fetchResponse?: object[];
}) {
  const { slug, queryClient, fetchResponse = [CATEGORY_RESEARCH, CATEGORY_VOLUNTEER] } = options;

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fetchResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  const routes = [
    {
      path: '/experiences',
      element: <ExperiencesPage />,
      children: [{ path: ':slug', element: <div>category placeholder</div> }],
    },
  ];

  const initialPath = slug ? `/experiences/${slug}` : '/experiences';

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const MENTOR_GRANT_CTX = {
  grant: {
    permissions: ['read'],
    applicantUserId: 'applicant-user-1',
    applicantName: 'Jane Applicant',
  },
};

/**
 * Render ExperiencesPage inside a MentorContext provider (simulates MentorScopeLayout).
 */
function renderPageWithMentorCtx(options: {
  slug?: string;
  queryClient: QueryClient;
  fetchResponse?: object[];
  mentorCtx?: typeof MENTOR_GRANT_CTX;
}) {
  const {
    slug,
    queryClient,
    fetchResponse = [CATEGORY_RESEARCH, CATEGORY_VOLUNTEER],
    mentorCtx = MENTOR_GRANT_CTX,
  } = options;

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fetchResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  const routes = [
    {
      path: '/mentor/:applicantUserId/experiences',
      element: (
        <MentorContext.Provider value={mentorCtx}>
          <ExperiencesPage />
        </MentorContext.Provider>
      ),
      children: [{ path: ':slug', element: <div>category placeholder</div> }],
    },
  ];

  const initialPath = slug
    ? `/mentor/${mentorCtx.grant.applicantUserId}/experiences/${slug}`
    : `/mentor/${mentorCtx.grant.applicantUserId}/experiences`;

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ExperiencesPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders both active category tabs with name(count) format', async () => {
    const qc = makeQueryClient({
      experiences: [
        { id: 'exp-1', categoryId: 'cat-1' },
        { id: 'exp-2', categoryId: 'cat-1' },
        { id: 'exp-3', categoryId: 'cat-2' },
      ],
    });

    renderPage({ slug: 'research', queryClient: qc });

    // Both tabs should appear with correct count
    await waitFor(() => {
      expect(screen.getByText('Research(2)')).toBeInTheDocument();
      expect(screen.getByText('Volunteer(1)')).toBeInTheDocument();
    });
  });

  it('shows 0 count when experiences cache is empty', async () => {
    const qc = makeQueryClient(); // no experiences in cache

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Research(0)')).toBeInTheDocument();
      expect(screen.getByText('Volunteer(0)')).toBeInTheDocument();
    });
  });

  it('redirects to first active category slug when no slug in URL', async () => {
    const qc = makeQueryClient();

    renderPage({ slug: undefined, queryClient: qc });

    // After categories load, navigate should be called to the first active category
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/experiences/research', { replace: true });
    });
  });

  it('does NOT render an inactive category tab', async () => {
    const qc = makeQueryClient();

    renderPage({
      slug: 'research',
      queryClient: qc,
      fetchResponse: [CATEGORY_RESEARCH, CATEGORY_VOLUNTEER, CATEGORY_INACTIVE],
    });

    await waitFor(() => {
      expect(screen.getByText('Research(0)')).toBeInTheDocument();
      expect(screen.getByText('Volunteer(0)')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Inactive Category/)).not.toBeInTheDocument();
  });

  it('marks the active tab with aria-current="page"', async () => {
    const qc = makeQueryClient();

    renderPage({ slug: 'volunteer', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Volunteer(0)')).toBeInTheDocument();
    });

    const volunteerBtn = screen.getByText('Volunteer(0)');
    expect(volunteerBtn).toHaveAttribute('aria-current', 'page');

    const researchBtn = screen.getByText('Research(0)');
    expect(researchBtn).not.toHaveAttribute('aria-current');
  });

  // -----------------------------------------------------------------------
  // Mentor context heading tests (UI-041)
  // -----------------------------------------------------------------------

  it('shows applicant name heading when mentor context is active', async () => {
    const qc = makeQueryClient();

    renderPageWithMentorCtx({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Experiences — Jane Applicant')).toBeInTheDocument();
    });
  });

  it('does not show mentor context heading in own/applicant view', async () => {
    const qc = makeQueryClient();

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Research(0)')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Experiences —/)).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Tab count accuracy on initial load (UI-050)
  // -----------------------------------------------------------------------

  it('shows accurate tab counts on first render when cache is cold', async () => {
    // Simulate cold cache: no experiences pre-seeded
    const qc = makeQueryClient(); // no experiences option

    // useExperiences returns data directly (simulates the hook resolving on mount)
    mockUseExperiences.mockReturnValue({
      data: [
        { id: 'exp-1', categoryId: 'cat-1' },
        { id: 'exp-2', categoryId: 'cat-1' },
        { id: 'exp-3', categoryId: 'cat-2' },
      ],
    });

    renderPage({ slug: 'research', queryClient: qc });

    // Both tabs must show non-zero counts from useExperiences, not 0 from cold cache
    await waitFor(() => {
      expect(screen.getByText('Research(2)')).toBeInTheDocument();
      expect(screen.getByText('Volunteer(1)')).toBeInTheDocument();
    });

    // Restore default so later tests are unaffected
    mockUseExperiences.mockReturnValue({ data: undefined });
  });

  // -----------------------------------------------------------------------
  // Export affordance (UI-107)
  // -----------------------------------------------------------------------

  it('renders a Download CSV button on the applicant view that opens the export with the current user id', async () => {
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    const qc = makeQueryClient();

    renderPage({ slug: 'research', queryClient: qc });

    const button = await screen.findByRole('button', { name: 'Download CSV' });
    button.click();

    expect(openMock).toHaveBeenCalledWith(
      '/api/experiences/export?owner_user_id=user-1',
    );
  });
});
