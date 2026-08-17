import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { MentorWorkspaceLayout } from './MentorWorkspaceLayout.js';

// MentorLevelBadge calls useMentorImpact which fetches; stub it out.
vi.mock('../components/MentorLevelBadge.js', () => ({
  MentorLevelBadge: () => null,
}));

// Mock useMe so tests are isolated from fetch and QueryClient state (UI-906).
vi.mock('../hooks/useMe.js', () => ({
  useMe: vi.fn(),
}));

import { useMe } from '../hooks/useMe.js';

// Mock Navigate to render a sentinel so we can assert it without real routing
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="navigate-redirect" data-to={to} />
    ),
  };
});

function mockMe(hasMentorGrants: boolean, isLoading = false, roles: string[] = ['applicant']) {
  vi.mocked(useMe).mockReturnValue({
    data: isLoading
      ? undefined
      : { user: { id: 'u1', email: 'm@b.com', name: 'M' }, roles, hasMentorGrants },
    isLoading,
  } as unknown as ReturnType<typeof useMe>);
}

function renderLayout(initialPath = '/mentor') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <MentorWorkspaceLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MentorWorkspaceLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state while useMe is loading', () => {
    mockMe(false, true);
    renderLayout();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('redirects to /home when the caller has no active mentor grants', async () => {
    mockMe(false);
    renderLayout();

    await waitFor(() => {
      const el = screen.getByTestId('navigate-redirect');
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute('data-to', '/home');
    });
  });

  it('terminates instead of redirecting when the caller has neither grants nor a role', async () => {
    // ApplicantLayout sends role-less accounts here; bouncing back to /home
    // would put the two guards in an infinite redirect loop.
    mockMe(false, false, []);
    renderLayout();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('no active mentor grants');
    });
    expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
  });

  it('redirects a grant-less admin to /admin rather than the applicant shell', async () => {
    mockMe(false, false, ['admin']);
    renderLayout();

    await waitFor(() => {
      expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/admin');
    });
  });

  describe('sidebar (rendered for a user with active mentor grants)', () => {
    beforeEach(() => {
      mockMe(true);
    });

    it('renders the BrandMark svg and the Mentor label, with no standalone "O" text', () => {
      const { container } = renderLayout();
      expect(container.querySelector('svg')).toBeInTheDocument();
      expect(screen.getByText('Mentor')).toBeInTheDocument();
      expect(screen.queryByText('O', { selector: 'span' })).toBeNull();
    });

    it('renders exactly two nav links: Dashboard and Talent pool', () => {
      renderLayout();
      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(2);
      expect(links[0]).toHaveAttribute('href', '/mentor');
      expect(links[0]).toHaveTextContent('Dashboard');
      expect(links[1]).toHaveAttribute('href', '/mentor/talent-pool');
      expect(links[1]).toHaveTextContent('Talent pool');
    });

    it('does not render My applicants, Verification queue, or Reports', () => {
      renderLayout();
      expect(screen.queryByText('My applicants')).toBeNull();
      expect(screen.queryByText('Verification queue')).toBeNull();
      expect(screen.queryByText('Reports')).toBeNull();
    });
  });
});
