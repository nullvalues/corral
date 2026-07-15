import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type Category =
  paths['/api/experience-categories']['get']['responses'][200]['content']['application/json'][number];

export type { Category };

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => apiFetch<Category[]>('/api/experience-categories'),
  });
}
