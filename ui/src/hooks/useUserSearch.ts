import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type UsersResponse = paths['/api/users']['get']['responses'][200]['content']['application/json'];
// The /api/users endpoint supports two modes: typeahead (array) and paginated list (object).
// useUserSearch always calls with ?email= and expects the array shape.
type UserSearchResult = Extract<UsersResponse, unknown[]>[number];

export type { UserSearchResult };

export function useUserSearch(email: string) {
  return useQuery({
    queryKey: queryKeys.userSearch(email),
    queryFn: () => {
      if (!email) return Promise.resolve([] as UserSearchResult[]);
      return apiFetch<UserSearchResult[]>(
        `/api/users?email=${encodeURIComponent(email)}`,
      );
    },
    enabled: email.length > 0,
    staleTime: 30_000,
  });
}
