import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type MentorGrant =
  paths['/api/mentor-grants']['get']['responses'][200]['content']['application/json'][number];

export type { MentorGrant };

export function useMentorGrants() {
  return useQuery({
    queryKey: queryKeys.mentorGrants,
    queryFn: () => apiFetch<MentorGrant[]>('/api/mentor-grants'),
  });
}
