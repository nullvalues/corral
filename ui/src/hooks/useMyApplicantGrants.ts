import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { apiFetch } from '../lib/apiFetch.js';

export interface ApplicantGrant {
  id: string;
  mentorUserId: string;
  applicantUserId: string;
  permissions: string[];
  grantedByUserId: string;
  grantedAt: string;
  status: string;
  requestedByUserId?: string | null;
  mentorEmail: string;
  mentorName: string;
}

export function useMyApplicantGrants() {
  return useQuery<ApplicantGrant[]>({
    queryKey: queryKeys.myApplicantGrants,
    queryFn: () => apiFetch<ApplicantGrant[]>('/api/mentor-grants/my-requests'),
  });
}
