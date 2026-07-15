import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type Experience =
  paths['/api/experiences']['get']['responses'][200]['content']['application/json'][number];

export function useExperiences(ownerUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.experiences(ownerUserId ?? ''),
    queryFn: () =>
      apiFetch<Experience[]>(
        `/api/experiences?owner_user_id=${encodeURIComponent(ownerUserId!)}`,
      ),
    enabled: !!ownerUserId,
  });
}
