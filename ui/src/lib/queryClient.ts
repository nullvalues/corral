import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';

/**
 * Dispatch the 're-auth' event when a 401 is detected.
 *
 * NOTE: Every queryFn / mutationFn must throw an object with a `status`
 * number property on non-2xx responses so this helper can detect 401s.
 * As of UI-093 this contract is enforced structurally at a single throw
 * site: all hooks call `apiFetch` (ui/src/lib/apiFetch.ts), which throws an
 * Error carrying { status, body } on every non-2xx response.
 */
function dispatch401(error: unknown): void {
  if (
    error != null &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: unknown }).status === 401
  ) {
    window.dispatchEvent(new CustomEvent('re-auth'));
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: dispatch401 }),
  mutationCache: new MutationCache({ onError: dispatch401 }),
  defaultOptions: { queries: { retry: false } },
});
