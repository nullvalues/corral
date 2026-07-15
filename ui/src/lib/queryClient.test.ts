import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryClient } from './queryClient.js';
import { QueryCache } from '@tanstack/react-query';

describe('queryClient', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('dispatches re-auth CustomEvent when QueryCache onError receives a 401', () => {
    const events: Event[] = [];
    const handler = (e: Event) => events.push(e);
    window.addEventListener('re-auth', handler);

    // Access the QueryCache's onError callback directly from the queryClient
    const queryCache = queryClient.getQueryCache() as QueryCache & {
      config: { onError?: (error: unknown) => void };
    };

    // Simulate a 401 error via the QueryCache onError handler
    queryCache.config.onError?.({ status: 401 });

    window.removeEventListener('re-auth', handler);

    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(CustomEvent);
    expect((events[0] as CustomEvent).type).toBe('re-auth');
  });

  it('does NOT dispatch re-auth for a non-401 error', () => {
    const events: Event[] = [];
    const handler = (e: Event) => events.push(e);
    window.addEventListener('re-auth', handler);

    const queryCache = queryClient.getQueryCache() as QueryCache & {
      config: { onError?: (error: unknown) => void };
    };

    queryCache.config.onError?.({ status: 500 });
    queryCache.config.onError?.(new Error('network failure'));
    queryCache.config.onError?.(null);

    window.removeEventListener('re-auth', handler);

    expect(events).toHaveLength(0);
  });

  it('dispatches re-auth CustomEvent when MutationCache onError receives a 401', () => {
    const events: Event[] = [];
    const handler = (e: Event) => events.push(e);
    window.addEventListener('re-auth', handler);

    const mutationCache = queryClient.getMutationCache() as {
      config: { onError?: (error: unknown) => void };
    };

    mutationCache.config.onError?.({ status: 401 });

    window.removeEventListener('re-auth', handler);

    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(CustomEvent);
    expect((events[0] as CustomEvent).type).toBe('re-auth');
  });

  it('has retry: false as the default query option', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(false);
  });

  it('does not dispatch re-auth for undefined error', () => {
    const events: Event[] = [];
    const handler = (e: Event) => events.push(e);
    window.addEventListener('re-auth', handler);

    const queryCache = queryClient.getQueryCache() as QueryCache & {
      config: { onError?: (error: unknown) => void };
    };

    queryCache.config.onError?.(undefined);

    window.removeEventListener('re-auth', handler);

    expect(events).toHaveLength(0);
  });
});
