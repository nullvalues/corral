import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';

/**
 * Mentor verify / un-verify an experience.
 * PATCH /api/experiences/:id/verification with { action: 'verify' | 'unverify' }.
 * Invalidates the owner's experiences + rollup so the badge updates inline. UI-037.
 */
export function useVerifyExperience(ownerUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; action: 'verify' | 'unverify' }) =>
      apiFetch<unknown>(
        `/api/experiences/${encodeURIComponent(vars.id)}/verification`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: vars.action }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.experiences(ownerUserId) });
      void qc.invalidateQueries({ queryKey: queryKeys.rollup(ownerUserId) });
      void qc.invalidateQueries({ queryKey: queryKeys.myMilestones });
    },
  });
}
