import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';

export function useCurrentUserId(): string | undefined {
  const qc = useQueryClient();
  const session = qc.getQueryData<{ user: { id: string } } | null>(queryKeys.session);
  return session?.user?.id;
}
