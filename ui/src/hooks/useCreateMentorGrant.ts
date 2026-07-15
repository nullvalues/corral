import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type CreateMentorGrantBody =
  paths['/api/mentor-grants']['post']['requestBody']['content']['application/json'];

type CreateMentorGrantResponse =
  paths['/api/mentor-grants']['post']['responses'][201]['content']['application/json'];

export function useCreateMentorGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMentorGrantBody) =>
      apiFetch<CreateMentorGrantResponse>('/api/mentor-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mentorGrants });
    },
  });
}
