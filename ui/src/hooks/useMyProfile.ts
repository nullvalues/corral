import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

export type MyProfile =
  paths['/api/me/profile']['get']['responses'][200]['content']['application/json'];

export function useMyProfile() {
  return useQuery({
    queryKey: queryKeys.myProfile,
    queryFn: () => apiFetch<MyProfile>('/api/me/profile'),
  });
}

export type MyHeadshot =
  paths['/api/me/headshot']['get']['responses'][200]['content']['application/json'];

/**
 * GET /api/me/headshot.
 *
 * On 200 returns `{ url }` (the pre-signed image URL). On 404 (no headshot set)
 * the query resolves to `null` rather than an error — the ProfilePage renders
 * its initials avatar in that case, and a "no photo yet" state must not surface
 * as an error toast. Any other non-2xx (401/500) still throws so the shared
 * 401 → re-auth path in queryClient continues to fire.
 */
export function useMyHeadshot() {
  return useQuery<MyHeadshot | null>({
    queryKey: queryKeys.myHeadshot,
    queryFn: async () => {
      try {
        return await apiFetch<MyHeadshot>('/api/me/headshot');
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    retry: false,
  });
}

export type UploadHeadshotError = Error & { status?: number };

/**
 * POST /api/me/headshot — multipart upload of a profile photo.
 *
 * Sends the raw File as multipart/form-data under the field name `file`. The
 * Content-Type header is intentionally NOT set so the browser adds the correct
 * multipart boundary. On success invalidates the headshot query (and the
 * profile query, whose DTO may carry the key) so the new image loads.
 *
 * A 413 (too large) or 415 (unsupported type) response throws an Error carrying
 * `status`, which the ProfilePage maps to a human message.
 */
export function useUploadHeadshot() {
  const qc = useQueryClient();
  return useMutation<MyHeadshot, UploadHeadshotError, File>({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<MyHeadshot>('/api/me/headshot', {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.myHeadshot });
      void qc.invalidateQueries({ queryKey: queryKeys.myProfile });
    },
  });
}
