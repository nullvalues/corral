/**
 * apiFetch — the single fetch seam for all UI → API traffic (UI-093).
 *
 * Every hook's queryFn / mutationFn calls this instead of raw `fetch`. It
 * guarantees two things that were previously enforced only by convention across
 * ~26 hand-rolled fetch blocks:
 *
 *  1. `credentials: 'include'` is always sent (caller `opts` may override other
 *     fields but the default carries the session cookie).
 *  2. On a non-2xx response it throws an `Error` instance carrying `status: number`
 *     and `body: unknown`. This is the exact shape `queryClient.ts` inspects to
 *     detect 401s and dispatch the `re-auth` event — now structurally guaranteed
 *     at the single throw site.
 *
 * 204 / empty-body responses return `undefined as T` (e.g. DELETE endpoints that
 * send no JSON), so callers typing `T` as `void` do not crash on `.json()`.
 */
export async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error('API error'), { status: res.status, body });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
