import { useParams } from 'react-router-dom';
import { useMentorContext } from '../layouts/MentorScopeLayout.js';
import { useTalentPool } from '../hooks/useTalentPool.js';
import { useReviewApplicant } from '../hooks/useReviewApplicant.js';

interface ShortlistControlProps {
  /** Optional explicit applicant id; falls back to mentor context / route param. */
  applicantUserId?: string;
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * B2 reviewer control: a 5-star rating + "Shortlist for interview" toggle.
 * Reviewer-isolated — reflects only the caller's own interview_shortlist row
 * for the focused applicant, sourced from the talent-pool query. UI-079.
 */
export function ShortlistControl({ applicantUserId }: ShortlistControlProps) {
  const mentorCtx = useMentorContext();
  const params = useParams<{ applicantUserId: string }>();
  const focusedId =
    applicantUserId ?? mentorCtx?.grant.applicantUserId ?? params.applicantUserId ?? '';

  const { data } = useTalentPool();
  const row = data?.find((e) => e.applicantUserId === focusedId);
  const shortlisted = row?.shortlisted ?? false;
  const starRating = row?.starRating ?? null;

  const { mutate } = useReviewApplicant(focusedId);

  const filled = starRating ?? 0;

  return (
    <div className="flex flex-col gap-3" data-testid="shortlist-control">
      <div className="flex items-center gap-1" role="group" aria-label="Star rating">
        {STARS.map((n) => {
          const isFilled = n <= filled;
          return (
            <button
              key={n}
              type="button"
              aria-label={`Rate ${n} stars`}
              className={`text-2xl leading-none ${
                isFilled ? 'text-primary-500' : 'text-faint'
              } hover:text-primary-700`}
              onClick={() => mutate({ shortlisted, starRating: n })}
            >
              ★
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-pressed={shortlisted}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
          shortlisted
            ? 'bg-primary-500 text-white'
            : 'border border-primary-500 text-primary-500'
        } hover:bg-primary-700 hover:text-white`}
        onClick={() => mutate({ shortlisted: !shortlisted, starRating })}
      >
        <span aria-hidden="true">★</span>
        Shortlist for interview
      </button>
    </div>
  );
}
