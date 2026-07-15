export const queryKeys = {
  session: ['session'] as const,
  me: ['me'] as const,
  categories: ['categories'] as const,
  experiences: (ownerUserId: string) => ['experiences', ownerUserId] as const,
  rollup: (ownerUserId: string) => ['rollup', ownerUserId] as const,
  mentorGrants: ['mentorGrants'] as const,
  pendingGrants: ['mentorGrants', 'pending'] as const,
  myMentorGrants: ['myMentorGrants'] as const,
  /** Applicant's own grant records (as the grantee / applicant side). */
  myApplicantGrants: ['myApplicantGrants'] as const,
  userSearch: (email: string) => ['userSearch', email] as const,
  userList: (page: number) => ['userList', page] as const,
  mentorImpact: ['mentorImpact'] as const,
  readinessConfig: ['readinessConfig'] as const,
  talentPool: ['talentPool'] as const,
  myMilestones: ['myMilestones'] as const,
  myProfile: ['myProfile'] as const,
  /** Applicant's own headshot pre-signed URL (GET /api/me/headshot). */
  myHeadshot: ['myHeadshot'] as const,
  /** Mentor-scoped read of an applicant's profile subset (per applicant id). */
  applicantProfile: (applicantUserId: string) =>
    ['applicantProfile', applicantUserId] as const,
  /** Applicant's own resume pre-signed URL (GET /api/me/resume). */
  myResume: ['myResume'] as const,
  /** Mentor-scoped resume pre-signed URL for an applicant (per applicant id). */
  applicantResume: (applicantUserId: string) =>
    ['applicantResume', applicantUserId] as const,
};
