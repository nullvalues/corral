import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';

export function useMyMentorGrants() {
  return useQuery({
    queryKey: queryKeys.myMentorGrants,
    queryFn: () =>
      apiFetch<
        Array<{
          id: string;
          applicantUserId: string;
          applicantName: string;
          applicantEmail: string;
          permissions: string[];
          status: string;
        }>
      >('/api/mentor-grants/mine'),
  });
}
