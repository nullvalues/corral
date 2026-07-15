import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMe } from './useMe.js';
import type { MeResponse } from './useMe.js';
import React from 'react';

const ME_FIXTURE: MeResponse = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
  roles: ['applicant'],
  hasMentorGrants: false,
};

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useMe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns data from GET /api/me on success', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ME_FIXTURE,
    } as Response);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMe(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(ME_FIXTURE);
    expect(fetchSpy).toHaveBeenCalledWith('/api/me', { credentials: 'include' });
  });

  it('throws an Error carrying { status } on non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMe(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // apiFetch (UI-093) throws an Error instance carrying status + body.
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error).toMatchObject({ status: 401 });
  });

  it('uses queryKeys.me as the query key', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ME_FIXTURE,
    } as Response);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMe(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The cache entry should be accessible under the 'me' key
    const cached = qc.getQueryData(['me']);
    expect(cached).toEqual(ME_FIXTURE);
  });
});
