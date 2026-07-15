import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';
import type { TalentPool } from './useTalentPool.js';

/**
 * PATCH body for the reviewer-owned interview_shortlist upsert.
 * Typed from the generated OpenAPI contract (api-types.ts) — the sole API
 * contract for the UI. API-044.
 */
type ReviewBody =
  paths['/api/mentor/applicants/{id}/review']['patch']['requestBody']['content']['application/json'];

/**
 * Reviewer shortlist / star-rating mutation for a single applicant.
 * PATCH /api/mentor/applicants/:id/review with { shortlisted, starRating }.
 * Optimistically patches the focused applicant's row in the talentPool cache,
 * rolls back on error, and invalidates talentPool on settle (mirrors the
 * useVerifyExperience invalidation discipline). UI-079.
 */
export function useReviewApplicant(applicantUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: ReviewBody) =>
      apiFetch<unknown>(
        `/api/mentor/applicants/${encodeURIComponent(applicantUserId)}/review`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vars),
        },
      ),
    onMutate: async (vars: ReviewBody) => {
      await qc.cancelQueries({ queryKey: queryKeys.talentPool });
      const prev = qc.getQueryData<TalentPool>(queryKeys.talentPool);
      qc.setQueryData<TalentPool>(queryKeys.talentPool, (old) =>
        old?.map((entry) =>
          entry.applicantUserId === applicantUserId
            ? { ...entry, shortlisted: vars.shortlisted, starRating: vars.starRating }
            : entry,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(queryKeys.talentPool, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.talentPool });
    },
  });
}
