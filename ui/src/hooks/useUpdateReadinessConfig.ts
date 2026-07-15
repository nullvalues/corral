import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type UpdateReadinessConfigBody =
  paths['/api/admin/readiness-config']['put']['requestBody']['content']['application/json'];

export type { UpdateReadinessConfigBody };

export function useUpdateReadinessConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateReadinessConfigBody) =>
      apiFetch<unknown>('/api/admin/readiness-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.readinessConfig });
    },
  });
}
