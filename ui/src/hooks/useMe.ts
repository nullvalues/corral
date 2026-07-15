import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';

export interface MeResponse {
  user: { id: string; email: string; name: string };
  roles: string[];
  hasMentorGrants: boolean;
}

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => apiFetch<MeResponse>('/api/me'),
    staleTime: 60_000,
  });
}
