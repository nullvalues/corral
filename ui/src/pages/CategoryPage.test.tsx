import { cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryPage } from './CategoryPage.js';

// ---------------------------------------------------------------------------
// Module-level mock for useDeleteExperience so tests can spy on mutate — UI-039
// ---------------------------------------------------------------------------
const deleteMutateSpy = vi.fn();
vi.mock('../hooks/useDeleteExperience.js', () => ({
  useDeleteExperience: () => ({ mutate: deleteMutateSpy }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATEGORY_A = {
  id: 'cat-a',
  slug: 'research',
  name: 'Research',
  sortOrder: 1,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
};

const CATEGORY_B = {
  id: 'cat-b',
  slug: 'volunteer',
  name: 'Volunteer',
  sortOrder: 2,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
};

function makeExperience(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'exp-1',
    ownerUserId: 'user-1',
    categoryId: 'cat-a',
    organization: 'Acme Corp',
    position: 'Researcher',
    frequency: null,
    startDate: '2023-01-01',
    endDate: null,
    dutiesNarrative: 'Did stuff',
    totalHours: 100,
    hoursPerWeek: 10,
    numberOfWeeks: 10,
    stateProvince: null,
    stateProvinceCode: null,
    country: null,
    countryIso2: null,
    countryIso3: null,
    isCurrent: false,
    receivedAcademicCredit: false,
    receivedSalaryOrPayment: false,
    isVolunteer: false,
    isMostImportant: false,
    permissionToContact: false,
    contactTitle: null,
    contactFirstName: null,
    contactLastName: null,
    contactEmail: null,
    contactPhone: null,
    verificationStatus: 'unverified',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a QueryClient with pre-populated caches.
 * - categories cache is always set (CategoryPage reads it via useQuery)
 * - experiences cache is set if `experiences` is provided
 * - rollup cache is set if `rollup` is provided
 * - session cache is always set so useCurrentUserId returns a value
 */
function makeQueryClient(options: {
  experiences?: ReturnType<typeof makeExperience>[];
  categories?: object[];
  rollup?: object[];
} = {}): QueryClient {
  const {
    experiences,
    categories = [CATEGORY_A, CATEGORY_B],
    rollup,
  } = options;

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  qc.setQueryData(['session'], { user: { id: 'user-1', twoFactorEnabled: true } });
  qc.setQueryData(['categories'], categories);

  if (experiences !== undefined) {
    qc.setQueryData(['experiences', 'user-1'], experiences);
  }

  if (rollup !== undefined) {
    qc.setQueryData(['rollup', 'user-1'], rollup);
  }

  return qc;
}

/**
 * Render CategoryPage inside a minimal router that supplies a :slug param.
 * Stubs global fetch so that any background refetch returns an empty array
 * without breaking the test (the interesting data comes from the cache).
 */
function renderPage(options: {
  slug: string;
  queryClient: QueryClient;
  // Override the experiences fetch response (only relevant when experiences cache is empty)
  fetchExperiences?: object[];
}) {
  const { slug, queryClient, fetchExperiences = [] } = options;

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/experience-categories')) {
        return Promise.resolve(
          new Response(JSON.stringify([CATEGORY_A, CATEGORY_B]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (String(url).includes('/api/experiences/rollup')) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      // Default: experiences endpoint
      return Promise.resolve(
        new Response(JSON.stringify(fetchExperiences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );

  const routes = [
    {
      path: '/experiences/:slug',
      element: <CategoryPage />,
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [`/experiences/${slug}`],
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CategoryPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Row filtering
  // -------------------------------------------------------------------------

  it('renders 2 rows when slug matches category A (2 experiences) and 1 row belongs to B', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Org Alpha', position: 'Alpha Role' }),
        makeExperience({ id: 'exp-2', categoryId: 'cat-a', organization: 'Org Beta', position: 'Beta Role' }),
        makeExperience({ id: 'exp-3', categoryId: 'cat-b', organization: 'Org Gamma', position: 'Gamma Role' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Org Alpha')).toBeInTheDocument();
      expect(screen.getByText('Org Beta')).toBeInTheDocument();
    });

    // Category B experience must NOT appear
    expect(screen.queryByText('Org Gamma')).not.toBeInTheDocument();

    // Exactly 2 experience cards
    const cards = screen.getAllByTestId('experience-card');
    expect(cards).toHaveLength(2);
  });

  it('renders 1 row when slug matches category B', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Org Alpha', position: 'Alpha Role' }),
        makeExperience({ id: 'exp-3', categoryId: 'cat-b', organization: 'Org Gamma', position: 'Gamma Role' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'volunteer', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Org Gamma')).toBeInTheDocument();
    });

    expect(screen.queryByText('Org Alpha')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it('renders "Add your first experience" CTA when category has no rows', async () => {
    const qc = makeQueryClient({
      experiences: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Add your first experience')).toBeInTheDocument();
    });
  });

  it('shows empty state when all experiences belong to a different category', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-3', categoryId: 'cat-b', organization: 'Org Gamma', position: 'Gamma Role' }),
      ],
    });

    // Render with slug=research (cat-a), which has 0 experiences
    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Add your first experience')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it('renders animate-pulse skeleton when experiences are loading', () => {
    // No experiences in cache → useExperiences will be in loading state
    // (fetch is stubbed to never resolve synchronously)
    const qc = makeQueryClient();
    // Do NOT pre-populate experiences cache so query stays in loading state

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => { /* never resolves */ })),
    );

    const routes = [{ path: '/experiences/:slug', element: <CategoryPage /> }];
    const router = createMemoryRouter(routes, { initialEntries: ['/experiences/research'] });

    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // Loading list must be present
    const loadingList = document.querySelector('[aria-label="loading"]');
    expect(loadingList).toBeInTheDocument();

    // Three skeleton cards with the expected testid
    const skeletonCards = screen.getAllByTestId('experience-card-skeleton');
    expect(skeletonCards).toHaveLength(3);

    // All skeleton cards have animate-pulse
    const pulseNodes = document.querySelectorAll('.animate-pulse');
    expect(pulseNodes.length).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  it('renders "Failed to load" with a Retry link when the experiences fetch fails', async () => {
    // No experiences in cache; fetch rejects
    const qc = makeQueryClient();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/api/experience-categories')) {
          return Promise.resolve(
            new Response(JSON.stringify([CATEGORY_A, CATEGORY_B]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        // experiences fetch returns 500
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );

    const routes = [{ path: '/experiences/:slug', element: <CategoryPage /> }];
    const router = createMemoryRouter(routes, { initialEntries: ['/experiences/research'] });

    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load/)).toBeInTheDocument();
      expect(screen.getByText('Retry?')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Rollup summary row
  // -------------------------------------------------------------------------

  it('shows the hero numeral 42 when rollup has an entry for the active category', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher' }),
      ],
      rollup: [
        { categoryId: 'cat-a', categorySlug: 'research', categoryName: 'Research', totalHours: 42 },
        { categoryId: 'cat-b', categorySlug: 'volunteer', categoryName: 'Volunteer', totalHours: 10 },
      ],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('shows the hero numeral 0 when rollup has no entry for the active category', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher' }),
      ],
      rollup: [
        { categoryId: 'cat-b', categorySlug: 'volunteer', categoryName: 'Volunteer', totalHours: 10 },
      ],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Edit button — UI-012
  // -------------------------------------------------------------------------

  it('renders an Edit button in each experience row', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher' }),
        makeExperience({ id: 'exp-2', categoryId: 'cat-a', organization: 'Org Beta', position: 'Beta Role' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    expect(editButtons).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Delete confirmation — UI-039
  // -------------------------------------------------------------------------

  it('does NOT call deleteMutation when window.confirm returns false', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    deleteMutateSpy.mockClear();

    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole('button', { name: /^delete$/i });
    fireEvent.click(deleteButton);

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete "Acme Corp — Researcher"? This cannot be undone.',
    );
    expect(deleteMutateSpy).not.toHaveBeenCalled();
  });

  it('calls deleteMutation with the experience id when window.confirm returns true', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteMutateSpy.mockClear();

    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole('button', { name: /^delete$/i });
    fireEvent.click(deleteButton);

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete "Acme Corp — Researcher"? This cannot be undone.',
    );
    expect(deleteMutateSpy).toHaveBeenCalledWith('exp-1');
  });

  it('clicking Edit button opens the ExperienceForm modal in edit mode', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const editButton = screen.getByRole('button', { name: /^edit$/i });
    fireEvent.click(editButton);

    // Modal heading should show "Edit Experience"
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /edit experience/i })).toBeInTheDocument();
    });

    // Form should show "Save Changes" button, confirming experienceId was passed
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Duties column — UI-043
  // -------------------------------------------------------------------------

  it('renders an experience card for each experience', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher' }),
        makeExperience({ id: 'exp-2', categoryId: 'cat-a', organization: 'Org Beta', position: 'Beta Role' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const cards = screen.getAllByTestId('experience-card');
    expect(cards).toHaveLength(2);
  });

  it('tapping a card opens the ExperienceDetailFlyout for that experience', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({
          id: 'exp-1',
          categoryId: 'cat-a',
          organization: 'Acme Corp',
          position: 'Researcher',
          dutiesNarrative: 'Conducted field research',
        }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByTestId('experience-card')[0]);

    // The flyout renders the duties narrative
    await waitFor(() => {
      expect(screen.getByText('Conducted field research')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Status column — UI-044
  // -------------------------------------------------------------------------

  it('renders a "Pending" badge in each experience card by default', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher', verificationStatus: 'unverified' }),
        makeExperience({ id: 'exp-2', categoryId: 'cat-a', organization: 'Org Beta', position: 'Beta Role', verificationStatus: 'unverified' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const badges = screen.getAllByTestId('verification-badge');
    // One badge per row (flyout is not open, so only table badges are visible)
    expect(badges).toHaveLength(2);
    badges.forEach((badge) => {
      expect(badge).toHaveTextContent('Pending');
    });
  });

  it('renders a "Verified" badge for a verified experience row', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher', verificationStatus: 'verified' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const badge = screen.getByTestId('verification-badge');
    expect(badge).toHaveTextContent('Verified');
  });

  // -------------------------------------------------------------------------
  // VMCAS threshold warning — UI-046
  // -------------------------------------------------------------------------

  it('marks the hours cell with data-testid and title when hours are below threshold for a known slug', async () => {
    // 'patient-care-experience' threshold is 1000 h; 50 h is below it
    const categories = [
      { id: 'cat-pce', slug: 'patient-care-experience', name: 'Patient Care Experience', sortOrder: 10, isActive: true, goalHours: 1000, createdAt: '2024-01-01T00:00:00Z' },
    ];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['session'], { user: { id: 'user-1', twoFactorEnabled: true } });
    qc.setQueryData(['categories'], categories);
    qc.setQueryData(['experiences', 'user-1'], [
      makeExperience({ id: 'exp-1', categoryId: 'cat-pce', organization: 'Hospital', position: 'Aide', totalHours: 50 }),
    ]);
    qc.setQueryData(['rollup', 'user-1'], []);

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/experience-categories')) {
        return Promise.resolve(new Response(JSON.stringify(categories), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));

    const routes = [{ path: '/experiences/:slug', element: <CategoryPage /> }];
    const router = createMemoryRouter(routes, { initialEntries: ['/experiences/patient-care-experience'] });
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);

    await waitFor(() => {
      expect(screen.getByText('Hospital')).toBeInTheDocument();
    });

    const cell = screen.getByTestId('hours-below-threshold');
    expect(cell).toBeInTheDocument();
    expect(cell).toHaveAttribute('title', 'Below VMCAS minimum');
    expect(cell).toHaveTextContent('50');
  });

  it('does NOT mark the hours cell when hours meet or exceed the threshold', async () => {
    // 'patient-care-experience' threshold is 1000 h; 1000 h is at threshold (not below)
    const categories = [
      { id: 'cat-pce', slug: 'patient-care-experience', name: 'Patient Care Experience', sortOrder: 10, isActive: true, createdAt: '2024-01-01T00:00:00Z' },
    ];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['session'], { user: { id: 'user-1', twoFactorEnabled: true } });
    qc.setQueryData(['categories'], categories);
    qc.setQueryData(['experiences', 'user-1'], [
      makeExperience({ id: 'exp-1', categoryId: 'cat-pce', organization: 'Hospital', position: 'Aide', totalHours: 1000 }),
    ]);
    qc.setQueryData(['rollup', 'user-1'], []);

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/experience-categories')) {
        return Promise.resolve(new Response(JSON.stringify(categories), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));

    const routes = [{ path: '/experiences/:slug', element: <CategoryPage /> }];
    const router = createMemoryRouter(routes, { initialEntries: ['/experiences/patient-care-experience'] });
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);

    await waitFor(() => {
      expect(screen.getByText('Hospital')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('hours-below-threshold')).not.toBeInTheDocument();
  });

  it('does NOT mark the hours cell for a category slug not in the threshold map', async () => {
    // CATEGORY_A has slug 'research' — not in VMCAS_THRESHOLDS (fail-open)
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Lab', position: 'Analyst', totalHours: 1 }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Lab')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('hours-below-threshold')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // hours-below-threshold CSS class — UI-048
  // -------------------------------------------------------------------------

  it('applies the hours-below-threshold CSS class when hours are below the threshold', async () => {
    // 'patient-care-experience' threshold is 1000 h; 50 h is below it → goalMet returns false
    const categories = [
      { id: 'cat-pce', slug: 'patient-care-experience', name: 'Patient Care Experience', sortOrder: 10, isActive: true, goalHours: 1000, createdAt: '2024-01-01T00:00:00Z' },
    ];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['session'], { user: { id: 'user-1', twoFactorEnabled: true } });
    qc.setQueryData(['categories'], categories);
    qc.setQueryData(['experiences', 'user-1'], [
      makeExperience({ id: 'exp-1', categoryId: 'cat-pce', organization: 'Clinic', position: 'Aide', totalHours: 50 }),
    ]);
    qc.setQueryData(['rollup', 'user-1'], []);

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/experience-categories')) {
        return Promise.resolve(new Response(JSON.stringify(categories), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));

    const routes = [{ path: '/experiences/:slug', element: <CategoryPage /> }];
    const router = createMemoryRouter(routes, { initialEntries: ['/experiences/patient-care-experience'] });
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);

    await waitFor(() => {
      expect(screen.getByText('Clinic')).toBeInTheDocument();
    });

    const cell = screen.getByTestId('hours-below-threshold');
    expect(cell).toHaveClass('hours-below-threshold');
  });

  it('does NOT apply the hours-below-threshold CSS class when hours meet or exceed the threshold', async () => {
    // 'patient-care-experience' threshold is 1000 h; 1000 h meets threshold → goalMet returns true
    const categories = [
      { id: 'cat-pce', slug: 'patient-care-experience', name: 'Patient Care Experience', sortOrder: 10, isActive: true, goalHours: 1000, createdAt: '2024-01-01T00:00:00Z' },
    ];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['session'], { user: { id: 'user-1', twoFactorEnabled: true } });
    qc.setQueryData(['categories'], categories);
    qc.setQueryData(['experiences', 'user-1'], [
      makeExperience({ id: 'exp-1', categoryId: 'cat-pce', organization: 'Clinic', position: 'Aide', totalHours: 1000 }),
    ]);
    qc.setQueryData(['rollup', 'user-1'], []);

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/experience-categories')) {
        return Promise.resolve(new Response(JSON.stringify(categories), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));

    const routes = [{ path: '/experiences/:slug', element: <CategoryPage /> }];
    const router = createMemoryRouter(routes, { initialEntries: ['/experiences/patient-care-experience'] });
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);

    await waitFor(() => {
      expect(screen.getByText('Clinic')).toBeInTheDocument();
    });

    // The hours chip must NOT carry the warning class
    const hoursCell = screen.getByText('1000 hrs');
    expect(hoursCell).not.toHaveClass('hours-below-threshold');
    expect(screen.queryByTestId('hours-below-threshold')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // End date rendering — UI-051
  // -------------------------------------------------------------------------

  it('renders N/A in the End Date cell when isCurrent is false and endDate is null', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher', isCurrent: false, endDate: null }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('renders Ongoing in the End Date cell when isCurrent is true', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher', isCurrent: true, endDate: null }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    expect(screen.getByText('Ongoing')).toBeInTheDocument();
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
  });

  it('renders the endDate string directly when isCurrent is false and endDate is provided', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher', isCurrent: false, endDate: '2024-06-30' }),
      ],
      rollup: [],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    expect(screen.getByText('2024-06-30')).toBeInTheDocument();
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(screen.queryByText('Ongoing')).not.toBeInTheDocument();
  });
});

describe('Momentum card render', () => {
  it('renders stacked cards with status + stat chips, hero numeral, and an Add FAB', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({ id: 'exp-1', categoryId: 'cat-a', organization: 'Acme Corp', position: 'Researcher', verificationStatus: 'verified', totalHours: 100, hoursPerWeek: 10, numberOfWeeks: 10 }),
        makeExperience({ id: 'exp-2', categoryId: 'cat-a', organization: 'Beta Org', position: 'Aide', verificationStatus: 'unverified' }),
      ],
      rollup: [{ categoryId: 'cat-a', categorySlug: 'research', categoryName: 'Research', totalHours: 42 }],
    });

    renderPage({ slug: 'research', queryClient: qc });

    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());

    // 2 cards
    expect(screen.getAllByTestId('experience-card')).toHaveLength(2);

    // status chips
    const badges = screen.getAllByTestId('verification-badge');
    expect(badges.some((b) => /Verified/.test(b.textContent ?? ''))).toBe(true);
    expect(badges.some((b) => /Pending/.test(b.textContent ?? ''))).toBe(true);

    // stat chips on the verified fixture
    const firstCard = screen.getAllByTestId('experience-card')[0];
    expect(within(firstCard).getByText('100 hrs')).toBeInTheDocument();
    expect(within(firstCard).getByText('10 hr/wk')).toBeInTheDocument();
    expect(within(firstCard).getByText('10 wks')).toBeInTheDocument();

    // hero numeral (rollup total)
    expect(screen.getByText('42')).toBeInTheDocument();

    // FAB
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });
});
