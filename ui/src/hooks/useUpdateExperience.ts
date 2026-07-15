import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { ExperienceFormValues } from '../forms/experienceFormSchema.js';

export function useUpdateExperience(ownerUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ExperienceFormValues }) =>
      apiFetch<unknown>(`/api/experiences/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.experiences(ownerUserId) });
      void qc.invalidateQueries({ queryKey: queryKeys.rollup(ownerUserId) });
      void qc.invalidateQueries({ queryKey: queryKeys.myMilestones });
    },
  });
}
