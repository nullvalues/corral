import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type UpdateCategoryBody =
  paths['/api/experience-categories/{id}']['patch']['requestBody']['content']['application/json'];

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCategoryBody }) =>
      apiFetch<unknown>(`/api/experience-categories/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.categories });
    },
  });
}
