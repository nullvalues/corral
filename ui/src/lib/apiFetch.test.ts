import { describe, it, expect, afterEach, vi } from 'vitest';
import { apiFetch } from './apiFetch.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  it('resolves the parsed JSON body typed as T on success', async () => {
    const payload = { id: 'x', name: 'thing' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response),
    );

    const result = await apiFetch<{ id: string; name: string }>('/api/thing');
    expect(result).toEqual(payload);
  });

  it('passes credentials: include to fetch by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/thing');
    expect(fetchMock).toHaveBeenCalledWith('/api/thing', {
      credentials: 'include',
    });
  });

  it('merges caller opts after the credentials default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/thing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/thing', {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  });

  it('rejects with an Error carrying status and parsed body on non-2xx', async () => {
    const errBody = { error: 'nope' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => errBody,
      } as Response),
    );

    await expect(apiFetch('/api/thing')).rejects.toMatchObject({
      status: 403,
      body: errBody,
    });
    await expect(apiFetch('/api/thing')).rejects.toBeInstanceOf(Error);
  });

  it('falls back to {} body when the error response is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response),
    );

    let caught: unknown;
    try {
      await apiFetch('/api/thing');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { status: number }).status).toBe(500);
    expect((caught as { body: unknown }).body).toEqual({});
  });

  it('returns undefined as T on a 204 no-content response without calling json()', async () => {
    const jsonSpy = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: jsonSpy,
      } as unknown as Response),
    );

    const result = await apiFetch<void>('/api/thing', { method: 'DELETE' });
    expect(result).toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });
});
