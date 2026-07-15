import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

export type MentorImpact =
  paths['/api/mentor/impact']['get']['responses'][200]['content']['application/json'];

export function useMentorImpact() {
  return useQuery({
    queryKey: queryKeys.mentorImpact,
    queryFn: () => apiFetch<MentorImpact>('/api/mentor/impact'),
  });
}
