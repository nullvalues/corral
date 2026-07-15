import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MentorStatusPage } from './MentorStatusPage.js';
import { queryKeys } from '../lib/queryKeys.js';
import type { ApplicantGrant } from '../hooks/useMyApplicantGrants.js';

// Mock react-router-dom's useNavigate
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function baseGrant(overrides: Partial<ApplicantGrant>): ApplicantGrant {
  return {
    id: 'g1',
    mentorUserId: 'm1',
    applicantUserId: 'a1',
    permissions: [],
    grantedByUserId: 'admin1',
    grantedAt: '2026-01-15T00:00:00.000Z',
    status: 'active',
    mentorEmail: 'mentor@example.com',
    mentorName: 'Jane Mentor',
    ...overrides,
  };
}

function renderPage(grants: ApplicantGrant[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.me, {
    user: { id: 'a1', email: 'a@example.com', name: 'App Licant' },
    roles: [],
    hasMentorGrants: false,
  });
  queryClient.setQueryData(queryKeys.myApplicantGrants, grants);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MentorStatusPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MentorStatusPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders mentor name and email for an active grant', () => {
    renderPage([baseGrant({ status: 'active' })]);
    expect(screen.getByText('Jane Mentor')).toBeTruthy();
    expect(screen.getByText('mentor@example.com')).toBeTruthy();
  });

  it('renders "Connected since" with a formatted date from grantedAt', () => {
    renderPage([baseGrant({ status: 'active', grantedAt: '2026-01-15T00:00:00.000Z' })]);
    const expected = new Date('2026-01-15T00:00:00.000Z').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    expect(screen.getByText(new RegExp(`Connected since\\s+${expected}`))).toBeTruthy();
  });

  it('renders a "Your experiences" button that navigates to /experiences', () => {
    renderPage([baseGrant({ status: 'active' })]);
    const btn = screen.getByRole('button', { name: /Your experiences/ });
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith('/experiences');
  });

  it('renders pending copy for a pending grant', () => {
    renderPage([baseGrant({ status: 'pending' })]);
    expect(screen.getByText(/Mentor request pending/)).toBeTruthy();
  });

  it('renders no-grant branch with "Request a mentor" button', () => {
    renderPage([]);
    expect(screen.getByText('No mentor assigned')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request a mentor' })).toBeTruthy();
  });

  it('does not flash the empty state while the grants query is pending', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.me, {
      user: { id: 'a1', email: 'a@example.com', name: 'App Licant' },
      roles: [],
      hasMentorGrants: false,
    });
    // No myApplicantGrants data set — the query is pending (isLoading true).
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MentorStatusPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('No mentor assigned')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request a mentor' })).toBeNull();
  });
});
