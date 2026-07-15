import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { FlagsAdminPage } from './FlagsAdminPage.js';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const OPEN_FLAG = {
  id: '11111111-1111-4111-8111-111111111111',
  reviewerUserId: 'mentor-001',
  experienceId: '22222222-2222-4222-8222-222222222222',
  reason: 'Hours look inflated',
  status: 'open',
  resolvedByUserId: null,
  resolvedAt: null,
  createdAt: '2026-07-01T00:00:00Z',
  organization: 'City Hospital',
  position: 'Volunteer',
  ownerUserId: 'applicant-001',
  reviewerName: 'Mentor Mary',
  reviewerEmail: 'mary@example.com',
};

const RESOLVED_FLAG = {
  ...OPEN_FLAG,
  id: '33333333-3333-4333-8333-333333333333',
  status: 'resolved',
  resolvedByUserId: 'admin-001',
  resolvedAt: '2026-07-02T00:00:00Z',
};

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  cleanup();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlagsAdminPage', () => {
  it('renders flag rows from the list endpoint with the table columns', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([OPEN_FLAG])));

    renderWithClient(<FlagsAdminPage />);

    const row = await screen.findByTestId(`flag-row-${OPEN_FLAG.id}`);
    expect(row).toHaveTextContent('City Hospital');
    expect(row).toHaveTextContent('Volunteer');
    expect(row).toHaveTextContent('applicant-001');
    expect(row).toHaveTextContent('Mentor Mary');
    expect(row).toHaveTextContent('Hours look inflated');
    expect(row).toHaveTextContent('open');
  });

  it('requests only open flags by default (?status=open)', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));

    renderWithClient(<FlagsAdminPage />);

    await screen.findByText('No open flags.');
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/api/admin/flags?status=open');
  });

  it('the show-all toggle fetches without a status filter', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));

    renderWithClient(<FlagsAdminPage />);
    await screen.findByText('No open flags.');

    fireEvent.click(screen.getByTestId('show-all-toggle'));

    await screen.findByText('No flags found.');
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/api/admin/flags');
  });

  it('"Mark resolved" fires the PATCH and refreshes the list', async () => {
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...RESOLVED_FLAG, id: OPEN_FLAG.id }));
      }
      return Promise.resolve(jsonResponse([OPEN_FLAG]));
    });

    renderWithClient(<FlagsAdminPage />);

    const btn = await screen.findByTestId(`resolve-btn-${OPEN_FLAG.id}`);
    fireEvent.click(btn);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(String(patchCall![0])).toBe(`/api/admin/flags/${OPEN_FLAG.id}`);
    });

    // Invalidation triggers a refetch of the list query
    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).startsWith('/api/admin/flags?status=open'),
      );
      expect(listCalls.length).toBeGreaterThan(1);
    });
  });

  it('does not render a resolve button on resolved flags', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([RESOLVED_FLAG])));

    renderWithClient(<FlagsAdminPage />);

    await screen.findByTestId(`flag-row-${RESOLVED_FLAG.id}`);
    expect(
      screen.queryByTestId(`resolve-btn-${RESOLVED_FLAG.id}`),
    ).not.toBeInTheDocument();
  });

  it('renders the error state when the list fetch fails', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'Forbidden' }, 403)),
    );

    renderWithClient(<FlagsAdminPage />);

    const err = await screen.findByText('Failed to load flags.');
    expect(err).toBeTruthy();
  });
});
