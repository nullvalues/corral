import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';
import type { MyProfile } from './useMyProfile.js';

export type UpdateMyProfileBody =
  paths['/api/me/profile']['patch']['requestBody']['content']['application/json'];

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMyProfileBody) =>
      apiFetch<MyProfile>('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.myProfile });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}
