import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MentorContext, MentorScopeLayout } from '../MentorScopeLayout.js';
import { CategoryPage } from '../../pages/CategoryPage.js';

// ---------------------------------------------------------------------------
// Mock useMentorGrant so tests are isolated from fetch and QueryClient state
// ---------------------------------------------------------------------------
vi.mock('../../hooks/useMentorGrant.js', () => ({
  useMentorGrant: vi.fn(),
}));

import { useMentorGrant } from '../../hooks/useMentorGrant.js';

// Mock Navigate to render a sentinel so we can assert redirects
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="navigate-redirect" data-to={to} />
    ),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APPLICANT_USER_ID = 'applicant-user-42';

const GRANT_WITH_WRITE = {
  id: 'grant-1',
  applicantUserId: APPLICANT_USER_ID,
  applicantName: 'Jane Doe',
  applicantEmail: 'jane@example.com',
  permissions: ['read', 'write'],
  status: 'active',
};

const GRANT_READ_ONLY = {
  id: 'grant-2',
  applicantUserId: APPLICANT_USER_ID,
  applicantName: 'Jane Doe',
  applicantEmail: 'jane@example.com',
  permissions: [],
  status: 'active',
};

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
    ownerUserId: APPLICANT_USER_ID,
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
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(options: {
  experiences?: ReturnType<typeof makeExperience>[];
  categories?: object[];
  rollup?: object[];
  sessionUserId?: string;
} = {}): QueryClient {
  const {
    experiences,
    categories = [CATEGORY_A, CATEGORY_B],
    rollup,
    sessionUserId = 'mentor-user-1',
  } = options;

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  qc.setQueryData(['session'], { user: { id: sessionUserId, twoFactorEnabled: true } });
  qc.setQueryData(['categories'], categories);

  if (experiences !== undefined) {
    qc.setQueryData(['experiences', APPLICANT_USER_ID], experiences);
  }

  if (rollup !== undefined) {
    qc.setQueryData(['rollup', APPLICANT_USER_ID], rollup);
  }

  return qc;
}

// ---------------------------------------------------------------------------
// MentorScopeLayout tests
// ---------------------------------------------------------------------------

describe('MentorScopeLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('redirects to /experiences when grant is not found for applicantUserId in params', async () => {
    vi.mocked(useMentorGrant).mockReturnValue({
      grant: null,
      isLoading: false,
    });

    const qc = makeQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/mentor/${APPLICANT_USER_ID}/experiences`]}>
          <Routes>
            <Route path="/mentor/:applicantUserId" element={<MentorScopeLayout />}>
              <Route path="experiences" element={<div>mentor outlet content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const redirect = screen.getByTestId('navigate-redirect');
      expect(redirect).toBeInTheDocument();
      expect(redirect).toHaveAttribute('data-to', '/experiences');
    });

    expect(screen.queryByText('mentor outlet content')).not.toBeInTheDocument();
  });

  it('renders Outlet children when grant matches applicantUserId in params', async () => {
    vi.mocked(useMentorGrant).mockReturnValue({
      grant: GRANT_WITH_WRITE,
      isLoading: false,
    });

    const qc = makeQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/mentor/${APPLICANT_USER_ID}/experiences`]}>
          <Routes>
            <Route path="/mentor/:applicantUserId" element={<MentorScopeLayout />}>
              <Route path="experiences" element={<div>mentor outlet content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('mentor outlet content')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
  });

  it('renders loading indicator while grant is loading', () => {
    vi.mocked(useMentorGrant).mockReturnValue({
      grant: null,
      isLoading: true,
    });

    const qc = makeQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/mentor/${APPLICANT_USER_ID}/experiences`]}>
          <Routes>
            <Route path="/mentor/:applicantUserId" element={<MentorScopeLayout />}>
              <Route path="experiences" element={<div>mentor outlet content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('mentor outlet content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CategoryPage write-gate tests (via MentorContext)
// ---------------------------------------------------------------------------

describe('CategoryPage — write-gate via MentorContext', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('hides Add, Edit, and Delete buttons when MentorContext has empty permissions', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({
          id: 'exp-1',
          categoryId: 'cat-a',
          organization: 'Acme Corp',
          position: 'Researcher',
        }),
      ],
      rollup: [],
    });

    render(
      <QueryClientProvider client={qc}>
        <MentorContext.Provider
          value={{ grant: { ...GRANT_READ_ONLY } }}
        >
          <MemoryRouter initialEntries={['/experiences/research']}>
            <Routes>
              <Route path="/experiences/:slug" element={<CategoryPage />} />
            </Routes>
          </MemoryRouter>
        </MentorContext.Provider>
      </QueryClientProvider>,
    );

    // Wait for the experience row to be visible
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    // Write-gated buttons must NOT appear
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('hides "Add your first experience" button when MentorContext has empty permissions and no experiences', async () => {
    const qc = makeQueryClient({
      experiences: [],
      rollup: [],
    });

    render(
      <QueryClientProvider client={qc}>
        <MentorContext.Provider
          value={{ grant: { ...GRANT_READ_ONLY } }}
        >
          <MemoryRouter initialEntries={['/experiences/research']}>
            <Routes>
              <Route path="/experiences/:slug" element={<CategoryPage />} />
            </Routes>
          </MemoryRouter>
        </MentorContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('No experiences in this category yet.')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /add your first experience/i })).not.toBeInTheDocument();
  });

  it('shows Add, Edit, and Delete buttons when MentorContext has write permission', async () => {
    const qc = makeQueryClient({
      experiences: [
        makeExperience({
          id: 'exp-1',
          categoryId: 'cat-a',
          organization: 'Acme Corp',
          position: 'Researcher',
        }),
      ],
      rollup: [],
    });

    render(
      <QueryClientProvider client={qc}>
        <MentorContext.Provider
          value={{ grant: { ...GRANT_WITH_WRITE } }}
        >
          <MemoryRouter initialEntries={['/experiences/research']}>
            <Routes>
              <Route path="/experiences/:slug" element={<CategoryPage />} />
            </Routes>
          </MemoryRouter>
        </MentorContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /^\+ add$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});
