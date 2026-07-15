import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type TalentPool =
  paths['/api/mentor/talent-pool']['get']['responses']['200']['content']['application/json'];

export type { TalentPool };
export type TalentPoolEntry = TalentPool[number];

export function useTalentPool() {
  return useQuery({
    queryKey: queryKeys.talentPool,
    queryFn: () => apiFetch<TalentPool>('/api/mentor/talent-pool'),
  });
}
