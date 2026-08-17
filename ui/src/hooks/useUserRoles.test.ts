/**
 * useUserRoles — derives isAdmin/isApplicant/isReady from useMe() (UI-905).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useUserRoles } from './useUserRoles.js';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useUserRoles', () => {
  it('is loading and not ready before useMe resolves', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => useUserRoles(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isReady).toBe(false);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isApplicant).toBe(false);
  });

  it('derives isAdmin=true and isApplicant=true for an admin+applicant account', async () => {
    const me = {
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
      roles: ['admin', 'applicant'],
      hasMentorGrants: false,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(me), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const { result } = renderHook(() => useUserRoles(), { wrapper });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isApplicant).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('derives isAdmin=false for an applicant-only account', async () => {
    const me = {
      user: { id: 'u2', email: 'b@b.com', name: 'B' },
      roles: ['applicant'],
      hasMentorGrants: false,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(me), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const { result } = renderHook(() => useUserRoles(), { wrapper });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isApplicant).toBe(true);
  });
});
