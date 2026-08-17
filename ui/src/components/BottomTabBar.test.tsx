import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BottomTabBar } from './BottomTabBar.js';

// Mock useMe so tests are isolated from fetch and QueryClient state (UI-907).
vi.mock('../hooks/useMe.js', () => ({
  useMe: vi.fn(),
}));

import { useMe } from '../hooks/useMe.js';

function mockMe(roles: string[]) {
  vi.mocked(useMe).mockReturnValue({
    data: { user: { id: 'u1', email: 'u@b.com', name: 'U' }, roles, hasMentorGrants: false },
    isLoading: false,
  } as unknown as ReturnType<typeof useMe>);
}

describe('BottomTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMe(['applicant']);
  });

  afterEach(() => {
    cleanup();
  });

  function renderBar(initialEntry = '/home') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <BottomTabBar />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders all four tab labels for an applicant account', () => {
    renderBar();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Mentor')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('marks the Home tab active with the brand-orange treatment when at /home', () => {
    renderBar('/home');
    const homeLink = screen.getByRole('link', { name: /home/i });
    expect(homeLink.className).toContain('text-primary-500');
  });

  it('renders inactive tabs with the muted treatment', () => {
    renderBar('/home');
    const profileLink = screen.getByRole('link', { name: /profile/i });
    expect(profileLink.className).toContain('text-muted');
    expect(profileLink.className).not.toContain('text-primary-500');
  });

  it('hides Categories and Mentor tabs for an admin-only account', () => {
    mockMe(['admin']);
    renderBar();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.queryByText('Categories')).toBeNull();
    expect(screen.queryByText('Mentor')).toBeNull();
  });
});
