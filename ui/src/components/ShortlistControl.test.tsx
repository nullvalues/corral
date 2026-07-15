import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShortlistControl } from './ShortlistControl.js';
import { queryKeys } from '../lib/queryKeys.js';
import type { TalentPool } from '../hooks/useTalentPool.js';

const FOCUS_ID = 'applicant-1';
const OTHER_ID = 'applicant-2';

function makeEntry(id: string, name: string, shortlisted: boolean, starRating: number | null) {
  return {
    applicantUserId: id,
    applicantName: name,
    applicantEmail: `${id}@example.com`,
    categories: [],
    experienceCount: 0,
    verifiedCount: 0,
    activeCategoryCount: 0,
    shortlisted,
    starRating,
  };
}

/**
 * URL-aware fetch mock backed by a mutable server pool. GET talent-pool returns
 * the current pool; PATCH review updates the pool (when patchOk) and returns the
 * review response — so the onSettled invalidate refetch stays consistent.
 */
function installFetch(pool: TalentPool, patchOk = true) {
  const server: TalentPool = pool.map((e) => ({ ...e }));
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/review')) {
      const body = JSON.parse((init?.body as string) ?? '{}');
      if (!patchOk) {
        return { ok: false, status: 403, json: async () => ({ error: 'x' }) } as Response;
      }
      const row = server.find(
        (e) => e.applicantUserId === decodeURIComponent(url.split('/applicants/')[1].split('/')[0]),
      );
      if (row) {
        row.shortlisted = body.shortlisted;
        row.starRating = body.starRating;
      }
      return { ok: true, json: async () => row } as Response;
    }
    return { ok: true, json: async () => server } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderControl(pool: TalentPool) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.talentPool, pool);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ShortlistControl applicantUserId={FOCUS_ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

function filledStarCount() {
  return screen
    .getAllByRole('button', { name: /Rate \d stars/ })
    .filter((b) => b.className.includes('text-primary-500')).length;
}

describe('ShortlistControl', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders exactly 3 filled stars when the caller current starRating is 3', () => {
    installFetch([makeEntry(FOCUS_ID, 'Focus', false, 3)]);
    renderControl([makeEntry(FOCUS_ID, 'Focus', false, 3)]);
    expect(filledStarCount()).toBe(3);
  });

  it('clicking star 5 PATCHes { starRating: 5 } and optimistically fills 5 stars', async () => {
    const fetchMock = installFetch([makeEntry(FOCUS_ID, 'Focus', false, 3)]);
    renderControl([makeEntry(FOCUS_ID, 'Focus', false, 3)]);

    fireEvent.click(screen.getByRole('button', { name: 'Rate 5 stars' }));

    await waitFor(() => expect(filledStarCount()).toBe(5));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mentor/applicants/${FOCUS_ID}/review`,
      expect.objectContaining({ method: 'PATCH' }),
    );
    const patchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/review'))!;
    expect(JSON.parse(String(patchCall[1]!.body)).starRating).toBe(5);
  });

  it('clicking the shortlist toggle PATCHes the flipped value and reflects it via aria-pressed', async () => {
    const fetchMock = installFetch([makeEntry(FOCUS_ID, 'Focus', false, null)]);
    renderControl([makeEntry(FOCUS_ID, 'Focus', false, null)]);

    const toggle = screen.getByRole('button', { name: /Shortlist for interview/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    const patchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/review'))!;
    expect(JSON.parse(String(patchCall[1]!.body)).shortlisted).toBe(true);
  });

  it('rolls back to 3 stars when the PATCH fails', async () => {
    installFetch([makeEntry(FOCUS_ID, 'Focus', false, 3)], false);
    renderControl([makeEntry(FOCUS_ID, 'Focus', false, 3)]);

    fireEvent.click(screen.getByRole('button', { name: 'Rate 5 stars' }));

    // optimistic fill then rollback to the persisted 3
    await waitFor(() => expect(filledStarCount()).toBe(3));
  });

  it('reflects only the focused applicant row, not another applicant in the pool', () => {
    installFetch([makeEntry(FOCUS_ID, 'Focus', false, 2), makeEntry(OTHER_ID, 'Other', true, 5)]);
    renderControl([
      makeEntry(FOCUS_ID, 'Focus', false, 2),
      makeEntry(OTHER_ID, 'Other', true, 5),
    ]);
    expect(filledStarCount()).toBe(2);
  });
});
