import { useMyMentorGrants } from './useMyMentorGrants.js';

export function useMentorGrant(applicantUserId: string | undefined) {
  const { data: grants, isLoading } = useMyMentorGrants();
  const grant = grants?.find((g) => g.applicantUserId === applicantUserId) ?? null;
  return { grant, isLoading };
}
