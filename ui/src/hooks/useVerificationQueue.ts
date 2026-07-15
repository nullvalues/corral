import { useQueries } from '@tanstack/react-query';
import { useMyMentorGrants } from './useMyMentorGrants.js';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type Experience =
  paths['/api/experiences']['get']['responses'][200]['content']['application/json'][number];

export type QueueRow = {
  experience: Experience;
  applicantName: string;
  applicantUserId: string;
};

/**
 * Assembles the mentor verification queue client-side:
 * - reads the caller's active grants from `useMyMentorGrants`
 * - fans out per-applicant via `useQueries` over `/api/experiences?owner_user_id=`
 * - flattens to a list of unverified rows with applicant context
 *
 * UI-073.
 */
export function useVerificationQueue(): {
  isLoading: boolean;
  rows: QueueRow[];
  pendingCount: number;
} {
  const { data: grants, isLoading: grantsLoading } = useMyMentorGrants();

  const activeGrants = (grants ?? []).filter((g) => g.status === 'active');

  const experienceResults = useQueries({
    queries: activeGrants.map((grant) => ({
      queryKey: queryKeys.experiences(grant.applicantUserId),
      queryFn: () =>
        apiFetch<Experience[]>(
          `/api/experiences?owner_user_id=${encodeURIComponent(grant.applicantUserId)}`,
        ),
    })),
  });

  const isLoading =
    grantsLoading || experienceResults.some((r) => r.isLoading);

  const rows: QueueRow[] = [];
  experienceResults.forEach((result, i) => {
    const grant = activeGrants[i];
    if (!grant || !result.data) return;
    result.data
      .filter((exp) => exp.verificationStatus === 'unverified')
      .forEach((exp) => {
        rows.push({
          experience: exp,
          applicantName: grant.applicantName,
          applicantUserId: grant.applicantUserId,
        });
      });
  });

  return {
    isLoading,
    rows,
    pendingCount: rows.length,
  };
}
