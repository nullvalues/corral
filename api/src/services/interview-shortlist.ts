// Service: interview_shortlist writes (API-044).
// upsertShortlistReview performs a reviewer-owned upsert keyed by the
// (reviewer_user_id, applicant_user_id) composite PK. The route gates the write
// with hasMentorGrant; this service is unconditional persistence only.
import { db } from '../db/index.js';
import { interviewShortlist } from '../db/schema/index.js';

export async function upsertShortlistReview(
  reviewerUserId: string,
  applicantUserId: string,
  patch: { shortlisted: boolean; starRating: number | null },
) {
  const [row] = await db
    .insert(interviewShortlist)
    .values({
      reviewerUserId,
      applicantUserId,
      shortlisted: patch.shortlisted,
      starRating: patch.starRating,
    })
    .onConflictDoUpdate({
      target: [interviewShortlist.reviewerUserId, interviewShortlist.applicantUserId],
      set: { shortlisted: patch.shortlisted, starRating: patch.starRating, updatedAt: new Date() },
    })
    .returning();
  return row;
}
