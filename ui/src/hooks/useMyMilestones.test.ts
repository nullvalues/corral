/**
 * useMyMilestones — fetch contract tests (UI-080).
 *
 * Asserts the hook calls GET /api/me/milestones with credentials and returns the
 * parsed MilestoneView[] array.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useMyMilestones } from './useMyMilestones.js';

const MILESTONES = [
  { key: 'first_experience', label: 'First experience', earned: true, earnedAt: '2026-01-01T00:00:00Z', remainingLabel: null },
  { key: 'hours_100', label: '100 hours', earned: false, earnedAt: null, remainingLabel: '40 to go' },
];

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useMyMilestones', () => {
  it('fetches /api/me/milestones with credentials and returns the parsed array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MILESTONES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMyMilestones(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith('/api/me/milestones', {
      credentials: 'include',
    });
    expect(result.current.data).toEqual(MILESTONES);
  });

  it('throws an Error carrying { status } on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 401 })),
    );

    const { result } = renderHook(() => useMyMilestones(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // apiFetch (UI-093) throws an Error instance carrying status + body.
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error).toMatchObject({ status: 401 });
  });
});
