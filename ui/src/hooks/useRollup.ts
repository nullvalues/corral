import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';

interface RollupEntry {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  totalHours: number;
}

export function useRollup(ownerUserId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.rollup(ownerUserId ?? ''),
    queryFn: () =>
      apiFetch<RollupEntry[]>(
        `/api/experiences/rollup?owner_user_id=${encodeURIComponent(ownerUserId!)}`,
      ),
    enabled: !!ownerUserId,
  });
}
