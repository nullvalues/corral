import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoriesAdminPage } from './CategoriesAdminPage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CAT_ACTIVE = {
  id: 'cat-1',
  slug: 'clinical-work',
  name: 'Clinical Work',
  sortOrder: 1,
  isActive: true,
  goalHours: 1000,
  createdAt: '2024-01-01T00:00:00Z',
};

const CAT_INACTIVE = {
  id: 'cat-2',
  slug: 'research',
  name: 'Research',
  sortOrder: 2,
  isActive: false,
  goalHours: null,
  createdAt: '2024-01-01T00:00:00Z',
};

const CAT_WITH_GOAL = {
  id: 'cat-3',
  slug: 'employment',
  name: 'Employment',
  sortOrder: 3,
  isActive: true,
  goalHours: 500,
  createdAt: '2024-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(categories?: object[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (categories !== undefined) {
    qc.setQueryData(['categories'], categories);
  }
  return qc;
}

function renderPage(queryClient: QueryClient) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([CAT_ACTIVE, CAT_INACTIVE]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <CategoriesAdminPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CategoriesAdminPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // List rendering
  // -------------------------------------------------------------------------

  it('renders category list with slug, name, sortOrder, and isActive badge', async () => {
    const qc = makeQueryClient([CAT_ACTIVE, CAT_INACTIVE]);
    renderPage(qc);

    await waitFor(() => {
      // Slugs
      expect(screen.getByText('clinical-work')).toBeInTheDocument();
      expect(screen.getByText('research')).toBeInTheDocument();
      // Names
      expect(screen.getByText('Clinical Work')).toBeInTheDocument();
      expect(screen.getByText('Research')).toBeInTheDocument();
      // Sort orders
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
      // Active badge
      expect(screen.getByText('Active')).toBeInTheDocument();
      // Inactive badge
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
  });

  it('renders a Deactivate button only on active rows', async () => {
    const qc = makeQueryClient([CAT_ACTIVE, CAT_INACTIVE]);
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('clinical-work')).toBeInTheDocument();
    });

    const deactivateButtons = screen.getAllByRole('button', { name: /deactivate/i });
    // Only one row (cat-1) is active
    expect(deactivateButtons).toHaveLength(1);
  });

  it('renders Edit buttons for each row', async () => {
    const qc = makeQueryClient([CAT_ACTIVE, CAT_INACTIVE]);
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('clinical-work')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    expect(editButtons).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Create form
  // -------------------------------------------------------------------------

  it('shows the create form when the Create button is clicked', async () => {
    const qc = makeQueryClient([CAT_ACTIVE]);
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. clinical-work')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Slug validation
  // -------------------------------------------------------------------------

  it('shows a validation error for an invalid slug and does not submit', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([CAT_ACTIVE]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeQueryClient([CAT_ACTIVE]);

    render(
      <QueryClientProvider client={qc}>
        <CategoriesAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    });

    // Open the create form
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. clinical-work')).toBeInTheDocument();
    });

    // Enter an invalid slug (starts with digit, which violates the regex)
    const slugInput = screen.getByPlaceholderText('e.g. clinical-work');
    const nameInput = screen.getByPlaceholderText('Display name');

    fireEvent.change(slugInput, { target: { value: '1invalid-slug' } });
    fireEvent.change(nameInput, { target: { value: 'Some Name' } });

    // Submit
    const submitButton = screen.getByRole('button', { name: /create category/i });
    fireEvent.click(submitButton);

    // Validation error must appear
    await waitFor(() => {
      expect(
        screen.getByText(/slug must start with a letter/i),
      ).toBeInTheDocument();
    });

    // The POST endpoint should NOT have been called
    const postCalls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => {
        const init = call[1] as RequestInit | undefined;
        return init?.method === 'POST';
      },
    );
    expect(postCalls).toHaveLength(0);
  });

  it('accepts a valid slug matching ^[a-z][a-z0-9-]{0,63}$', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'cat-new',
              slug: 'valid-slug',
              name: 'Valid',
              sortOrder: 0,
              isActive: true,
              goalHours: null,
              createdAt: '2024-01-01T00:00:00Z',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([CAT_ACTIVE]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = makeQueryClient([CAT_ACTIVE]);

    render(
      <QueryClientProvider client={qc}>
        <CategoriesAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. clinical-work')).toBeInTheDocument();
    });

    const slugInput = screen.getByPlaceholderText('e.g. clinical-work');
    const nameInput = screen.getByPlaceholderText('Display name');

    fireEvent.change(slugInput, { target: { value: 'valid-slug' } });
    fireEvent.change(nameInput, { target: { value: 'Valid' } });

    const submitButton = screen.getByRole('button', { name: /create category/i });
    fireEvent.click(submitButton);

    // No slug validation error should appear
    await waitFor(() => {
      expect(screen.queryByText(/slug must start with a letter/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Goal hours — table rendering
  // -------------------------------------------------------------------------

  it('renders goalHours integer in the Goal hours column', async () => {
    const qc = makeQueryClient([CAT_ACTIVE]);
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('clinical-work')).toBeInTheDocument();
    });

    // CAT_ACTIVE has goalHours: 1000
    expect(screen.getByText('1000')).toBeInTheDocument();
  });

  it('renders "No minimum" when goalHours is null', async () => {
    const qc = makeQueryClient([CAT_INACTIVE]);
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('research')).toBeInTheDocument();
    });

    // CAT_INACTIVE has goalHours: null
    expect(screen.getByText('No minimum')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Goal hours — edit form pre-population
  // -------------------------------------------------------------------------

  it('shows empty Goal hours input when editing a category with goalHours: null', async () => {
    const qc = makeQueryClient([CAT_INACTIVE]);
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('research')).toBeInTheDocument();
    });

    // Click Edit on CAT_INACTIVE
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Blank = no minimum')).toBeInTheDocument();
    });

    const goalInput = screen.getByPlaceholderText('Blank = no minimum') as HTMLInputElement;
    expect(goalInput.value).toBe('');
  });

  it('shows 500 in Goal hours input when editing a category with goalHours: 500', async () => {
    const qc = makeQueryClient([CAT_WITH_GOAL]);
    renderPage(qc);

    await waitFor(() => {
      expect(screen.getByText('employment')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Blank = no minimum')).toBeInTheDocument();
    });

    const goalInput = screen.getByPlaceholderText('Blank = no minimum') as HTMLInputElement;
    expect(goalInput.value).toBe('500');
  });

  // -------------------------------------------------------------------------
  // Goal hours — create form submit wiring
  // -------------------------------------------------------------------------

  it('calls create mutation with goalHours: null when Goal hours is left blank', async () => {
    let capturedBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'cat-new',
              slug: 'new-cat',
              name: 'New Cat',
              sortOrder: 0,
              isActive: true,
              goalHours: null,
              createdAt: '2024-01-01T00:00:00Z',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
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

    const qc = makeQueryClient([]);
    render(
      <QueryClientProvider client={qc}>
        <CategoriesAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. clinical-work')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('e.g. clinical-work'), {
      target: { value: 'new-cat' },
    });
    fireEvent.change(screen.getByPlaceholderText('Display name'), {
      target: { value: 'New Cat' },
    });
    // Leave Goal hours blank

    fireEvent.click(screen.getByRole('button', { name: /create category/i }));

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });

    expect((capturedBody as Record<string, unknown>).goalHours).toBeNull();
  });

  it('calls create mutation with goalHours: 750 when 750 is entered', async () => {
    let capturedBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'cat-new',
              slug: 'new-cat',
              name: 'New Cat',
              sortOrder: 0,
              isActive: true,
              goalHours: 750,
              createdAt: '2024-01-01T00:00:00Z',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
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

    const qc = makeQueryClient([]);
    render(
      <QueryClientProvider client={qc}>
        <CategoriesAdminPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. clinical-work')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('e.g. clinical-work'), {
      target: { value: 'new-cat' },
    });
    fireEvent.change(screen.getByPlaceholderText('Display name'), {
      target: { value: 'New Cat' },
    });
    fireEvent.change(screen.getByPlaceholderText('Blank = no minimum'), {
      target: { value: '750' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create category/i }));

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });

    expect((capturedBody as Record<string, unknown>).goalHours).toBe(750);
  });
});
