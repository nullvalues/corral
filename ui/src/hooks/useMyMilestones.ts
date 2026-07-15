import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';

/**
 * useMyMilestones — server-confirmed milestone strip source (PM038, UI-080).
 *
 * Fetches the caller's stored milestone_award rows (GET /api/me/milestones) as
 * MilestoneView[]. `earned` reflects the persisted award row, not a client-side
 * predicate re-derivation — this is the source of truth for both the strip and
 * the server-confirmed celebration (see useMilestoneAward).
 */
export interface MilestoneView {
  key: string;
  label: string;
  earned: boolean;
  earnedAt: string | null;
  remainingLabel: string | null;
}

export function useMyMilestones() {
  return useQuery({
    queryKey: queryKeys.myMilestones,
    queryFn: () => apiFetch<MilestoneView[]>('/api/me/milestones'),
  });
}
