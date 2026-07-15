import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type ReadinessConfig =
  paths['/api/readiness-config']['get']['responses'][200]['content']['application/json'];

export type { ReadinessConfig };

export function useReadinessConfig() {
  return useQuery({
    queryKey: queryKeys.readinessConfig,
    queryFn: () => apiFetch<ReadinessConfig>('/api/readiness-config'),
    staleTime: Infinity, // config is fetched once; CRUD never refetches it (D1)
  });
}
