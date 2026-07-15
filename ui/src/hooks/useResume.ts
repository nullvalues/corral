import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

export type MyResume =
  paths['/api/me/resume']['get']['responses'][200]['content']['application/json'];

export type ApplicantResume =
  paths['/api/mentor/applicants/{id}/resume']['get']['responses'][200]['content']['application/json'];

/**
 * GET /api/me/resume.
 *
 * On 200 returns `{ url }` (pre-signed PDF URL). On 404 (no resume uploaded)
 * resolves to `null` — the empty state, not an error. 403/401/500 still throw
 * so the 401 → re-auth path continues to fire.
 */
export function useMyResume() {
  return useQuery<MyResume | null>({
    queryKey: queryKeys.myResume,
    queryFn: async () => {
      try {
        return await apiFetch<MyResume>('/api/me/resume');
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    retry: false,
  });
}

export type UploadResumeError = Error & { status?: number };

/**
 * POST /api/me/resume — multipart upload of a PDF resume.
 *
 * Sends the File as multipart/form-data under field `file`. On success
 * invalidates the resume query so the "uploaded" state appears.
 *
 * 413 (too large) and 415 (not PDF) throw an Error carrying `status`, which the
 * ProfilePage maps to human messages.
 */
export function useUploadResume() {
  const qc = useQueryClient();
  return useMutation<MyResume, UploadResumeError, File>({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<MyResume>('/api/me/resume', {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.myResume });
    },
  });
}

/**
 * DELETE /api/me/resume — removes the applicant's uploaded resume.
 *
 * On success invalidates the resume query so the section returns to the empty
 * upload state.
 */
export function useDeleteResume() {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () =>
      apiFetch<void>('/api/me/resume', { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.myResume });
    },
  });
}

/**
 * GET /api/mentor/applicants/:id/resume — mentor-scoped pre-signed resume URL.
 *
 * Resolves to `{ url }` on 200, `null` on 404 (no resume uploaded — not an
 * error), and `null` on 403 (grant enforcement is server-side — panel simply
 * omits the link). Other non-2xx still throw.
 */
export function useApplicantResume(applicantUserId: string) {
  return useQuery<ApplicantResume | null>({
    queryKey: queryKeys.applicantResume(applicantUserId),
    queryFn: async () => {
      try {
        return await apiFetch<ApplicantResume>(
          `/api/mentor/applicants/${applicantUserId}/resume`,
        );
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 404 || status === 403) return null;
        throw err;
      }
    },
    enabled: Boolean(applicantUserId),
    retry: false,
  });
}
