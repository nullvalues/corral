import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

export type ApplicantProfile =
  paths['/api/mentor/applicants/{id}/profile']['get']['responses'][200]['content']['application/json'];

/**
 * Mentor-scoped read of an applicant's profile subset
 * (GET /api/mentor/applicants/:id/profile — API-057).
 * Deliberately excludes phone and gpa. Access is ABAC-gated server-side;
 * a denied/failed request surfaces via `isError`.
 */
export function useApplicantProfile(applicantUserId: string) {
  return useQuery({
    queryKey: queryKeys.applicantProfile(applicantUserId),
    queryFn: () =>
      apiFetch<ApplicantProfile>(
        `/api/mentor/applicants/${encodeURIComponent(applicantUserId)}/profile`,
      ),
    enabled: applicantUserId !== '',
  });
}
