import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MentorWorkspaceLayout } from './MentorWorkspaceLayout.js';

// MentorLevelBadge calls useMentorImpact which fetches; stub it out.
vi.mock('../components/MentorLevelBadge.js', () => ({
  MentorLevelBadge: () => null,
}));

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

describe('MentorWorkspaceLayout sidebar', () => {
  afterEach(() => {
    cleanup();
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
