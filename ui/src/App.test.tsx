import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MentorWorkspaceLayout } from './layouts/MentorWorkspaceLayout.js';
import { MentorDashboardPage } from './pages/MentorDashboardPage.js';

// Prevent the real useMentorImpact hook from calling useQuery without a provider
vi.mock('./hooks/useMentorImpact.js', () => ({
  useMentorImpact: () => ({ data: undefined, isLoading: true, isError: false }),
}));

/**
 * UI-001 — router shell tests.
 *
 * Verifies that each top-level route renders its placeholder element.
 * Uses createMemoryRouter for isolated, path-specific rendering.
 */

const routes = [
  { path: '/sign-up', element: <div>sign-up placeholder</div> },
  { path: '/sign-in', element: <div>sign-in placeholder</div> },
  { path: '/enrol', element: <div>enrol placeholder</div> },
  { path: '/', element: <div>protected placeholder</div> },
];

describe('route placeholders', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders protected placeholder at /', () => {
    const testRouter = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={testRouter} />);
    expect(screen.getByText('protected placeholder')).toBeInTheDocument();
  });

  it('renders sign-up placeholder at /sign-up', () => {
    const testRouter = createMemoryRouter(routes, {
      initialEntries: ['/sign-up'],
    });
    render(<RouterProvider router={testRouter} />);
    expect(screen.getByText('sign-up placeholder')).toBeInTheDocument();
  });

  it('renders sign-in placeholder at /sign-in', () => {
    const testRouter = createMemoryRouter(routes, {
      initialEntries: ['/sign-in'],
    });
    render(<RouterProvider router={testRouter} />);
    expect(screen.getByText('sign-in placeholder')).toBeInTheDocument();
  });

  it('renders enrol placeholder at /enrol', () => {
    const testRouter = createMemoryRouter(routes, {
      initialEntries: ['/enrol'],
    });
    render(<RouterProvider router={testRouter} />);
    expect(screen.getByText('enrol placeholder')).toBeInTheDocument();
  });
});

describe('mentor workspace shell (UI-071)', () => {
  afterEach(() => {
    cleanup();
  });

  it('mounts MentorDashboardPage inside the workspace shell at /mentor', () => {
    const testRouter = createMemoryRouter(
      [
        {
          path: '/mentor',
          element: <MentorWorkspaceLayout />,
          children: [{ index: true, element: <MentorDashboardPage /> }],
        },
      ],
      { initialEntries: ['/mentor'] },
    );
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={testRouter} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: /mentor dashboard/i })).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Talent pool')).toBeInTheDocument();
    expect(screen.getByTestId('mentor-level-card')).toBeInTheDocument();
  });
});
