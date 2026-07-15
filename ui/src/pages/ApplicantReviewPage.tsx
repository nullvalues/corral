import { useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useMentorContext } from '../layouts/MentorScopeLayout.js';
import { useExperiences } from '../hooks/useExperiences.js';
import { useRollup } from '../hooks/useRollup.js';
import { useCategories } from '../hooks/useCategories.js';
import { useVerifyExperience } from '../hooks/useVerifyExperience.js';
import { useCreateFlag } from '../hooks/useCreateFlag.js';
import { Modal } from '../components/Modal.js';
import { computeReadiness, DEFAULT_READINESS_WEIGHTS } from '../lib/readiness.js';
import { useReadinessConfig } from '../hooks/useReadinessConfig.js';
import { useApplicantProfile } from '../hooks/useApplicantProfile.js';
import { useApplicantResume } from '../hooks/useResume.js';
import { ProgressRing } from '../components/ProgressRing.js';
import type { paths } from '../api-types.js';
import { getInitials } from '../lib/initials.js';

type Experience =
  paths['/api/experiences']['get']['responses'][200]['content']['application/json'][number];

/** Status filter states for the experience list (UI-102). */
type StatusFilter = 'all' | 'unverified' | 'verified';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'verified', label: 'Verified' },
];

/**
 * B2 — Mentor-scoped applicant review + verify screen.
 * Mounted as the index route under /mentor/:applicantUserId (UI-074).
 * Requires: MentorScopeLayout context (ABAC write grant asserted by the layout).
 */
export function ApplicantReviewPage(): ReactElement {
  const { applicantUserId: paramId } = useParams<{ applicantUserId: string }>();
  const mentorCtx = useMentorContext();

  const applicantUserId = mentorCtx?.grant.applicantUserId ?? paramId ?? '';
  const applicantName = mentorCtx?.grant.applicantName ?? 'Applicant';

  const { data: experiences = [] } = useExperiences(applicantUserId);
  const { data: rollup = [] } = useRollup(applicantUserId);
  const { data: categories = [] } = useCategories();
  const { data: weights } = useReadinessConfig();
  const { data: profile } = useApplicantProfile(applicantUserId);
  const { data: applicantResume } = useApplicantResume(applicantUserId);

  const { mutate: verify } = useVerifyExperience(applicantUserId);

  // Experience currently being flagged (null = flag modal closed). UI-101.
  const [flagTargetId, setFlagTargetId] = useState<string | null>(null);

  // Client-side search + status filter over the fetched experiences (UI-102).
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredExperiences = useMemo(() => {
    const term = search.trim().toLowerCase();
    return experiences.filter((e) => {
      if (statusFilter !== 'all' && e.verificationStatus !== statusFilter) {
        return false;
      }
      if (term.length === 0) return true;
      return (
        e.organization.toLowerCase().includes(term) ||
        e.position.toLowerCase().includes(term) ||
        e.dutiesNarrative.toLowerCase().includes(term)
      );
    });
  }, [experiences, search, statusFilter]);

  const activeCategories = categories
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const readiness = computeReadiness(
    {
      rollup,
      experiences: experiences.map((e) => ({
        categoryId: e.categoryId,
        verificationStatus: e.verificationStatus,
      })),
      activeCategories: activeCategories.map((c) => ({ id: c.id, goalHours: c.goalHours })),
    },
    weights ?? DEFAULT_READINESS_WEIGHTS,
  );

  const verifiedCount = experiences.filter((e) => e.verificationStatus === 'verified').length;
  const totalCount = experiences.length;

  // Hours by category mini bars
  const hoursByCat = new Map(rollup.map((r) => [r.categoryId, r.totalHours]));

  // Avatar initials
  const initials = getInitials(applicantName);

  // Group the filtered experiences by categoryId (UI-102); empty categories
  // are hidden by the render guard below.
  const expsByCategory = new Map<string, Experience[]>();
  for (const exp of filteredExperiences) {
    const list = expsByCategory.get(exp.categoryId) ?? [];
    list.push(exp);
    expsByCategory.set(exp.categoryId, list);
  }

  const bannerProgress = totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── Left panel ─────────────────────────────────────── */}
      <aside
        data-testid="left-panel"
        className="w-64 shrink-0 border-r border-hairline bg-card p-6 flex flex-col gap-6"
      >
        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-3">
          <div
            data-testid="avatar"
            className="w-16 h-16 rounded-full bg-ink flex items-center justify-center"
          >
            <span className="text-xl font-bold text-white">{initials}</span>
          </div>
          <p
            data-testid="applicant-name"
            className="font-display text-base font-semibold text-ink text-center"
          >
            {applicantName}
          </p>
        </div>

        {/* Profile card */}
        <ProfileCard profile={profile} resumeUrl={applicantResume?.url ?? null} />

        {/* 120px readiness ring */}
        <div className="flex justify-center" data-testid="readiness-ring">
          <ProgressRing value={readiness} size={120} stroke={10} caption="READY" />
        </div>

        {/* Hours-by-category mini bars */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-widest text-muted uppercase">
            HOURS BY CATEGORY
          </p>
          {activeCategories.map((cat) => {
            const hrs = hoursByCat.get(cat.id) ?? 0;
            const goal = cat.goalHours;
            const pct =
              goal !== null && goal > 0
                ? Math.min(100, Math.round((hrs / goal) * 100))
                : null;
            return (
              <div key={cat.id} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="max-w-[120px] truncate text-xs text-muted">
                    {cat.name}
                  </span>
                  <span className="tabular-nums text-xs font-medium text-ink">
                    {hrs}h
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-hairline/30">
                  <div
                    className="h-full rounded-full bg-primary-500 transition-all"
                    style={{ width: pct !== null ? `${pct}%` : '0%' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {/* Verify-progress banner */}
        <div
          data-testid="verify-banner"
          className="bg-ink px-6 py-4 flex flex-col gap-2"
        >
          <p className="font-semibold text-white">
            Almost there —{' '}
            <span data-testid="banner-count">
              {verifiedCount} of {totalCount} verified
            </span>
          </p>
          <p className="text-sm text-white/60">
            Verifying more experiences improves this applicant's readiness score.
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <div
              data-testid="banner-progress-bar"
              className="h-full rounded-full bg-primary-500 transition-all"
              style={{ width: `${bannerProgress}%` }}
            />
          </div>
        </div>

        {/* Search + status filter controls (UI-102) */}
        <div className="flex flex-wrap items-center gap-3 px-6 pt-6">
          <input
            type="search"
            data-testid="experience-search-input"
            aria-label="Search experiences"
            placeholder="Search organization, position, or duties…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm rounded-lg border border-hairline bg-card px-3 py-2 text-sm text-ink placeholder:text-muted"
          />

          <div
            role="group"
            aria-label="Filter by verification status"
            className="flex overflow-hidden rounded-lg border border-hairline"
          >
            {STATUS_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                data-testid={`status-filter-${value}`}
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  statusFilter === value
                    ? 'bg-primary-500 text-white'
                    : 'bg-card text-muted hover:bg-border/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Per-category sections */}
        <div className="flex flex-col gap-8 p-6">
          {activeCategories.map((cat) => {
            const catExps = expsByCategory.get(cat.id) ?? [];
            if (catExps.length === 0) return null;

            const pending = catExps.filter((e) => e.verificationStatus === 'unverified');
            const verified = catExps.filter((e) => e.verificationStatus === 'verified');

            return (
              <section key={cat.id} data-testid={`category-section-${cat.slug}`}>
                <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted uppercase">
                  {cat.name}
                </h2>

                <div className="flex flex-col gap-2">
                  {/* Pending rows — orange-border card */}
                  {pending.map((exp) => (
                    <PendingRow
                      key={exp.id}
                      exp={exp}
                      onVerify={() => verify({ id: exp.id, action: 'verify' })}
                      onFlag={() => setFlagTargetId(exp.id)}
                    />
                  ))}

                  {/* Verified rows — calm white row */}
                  {verified.map((exp) => (
                    <VerifiedRow key={exp.id} exp={exp} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </main>

      {/* Flag modal (UI-101) */}
      {flagTargetId !== null && (
        <FlagModal
          experienceId={flagTargetId}
          onClose={() => setFlagTargetId(null)}
        />
      )}
    </div>
  );
}

/**
 * Flag-an-experience modal (UI-101): reason textarea + "Submit flag" button.
 * Posts via useCreateFlag (POST /api/experiences/:id/flag); success and error
 * states are shown inline in the modal.
 */
function FlagModal({
  experienceId,
  onClose,
}: {
  experienceId: string;
  onClose: () => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const { mutate, isPending, isSuccess, isError } = useCreateFlag();

  return (
    <Modal title="Flag experience" onClose={onClose}>
      {isSuccess ? (
        <div className="flex flex-col gap-4">
          <p data-testid="flag-success" className="text-sm text-success-700">
            Flag submitted. An admin will review it.
          </p>
          <button
            type="button"
            data-testid="flag-close-btn"
            onClick={onClose}
            className="self-end rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 transition-colors"
          >
            Done
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length === 0) return;
            mutate({ id: experienceId, reason: reason.trim() });
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-ink">
            Why are you flagging this experience?
            <textarea
              data-testid="flag-reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1024}
              rows={4}
              className="rounded-lg border border-hairline bg-card p-2 text-sm text-ink"
            />
          </label>

          {isError && (
            <p data-testid="flag-error" className="text-sm text-danger-700">
              Failed to submit flag. Please try again.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:bg-border/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="flag-submit-btn"
              disabled={isPending || reason.trim().length === 0}
              className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Submitting…' : 'Submit flag'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

type ApplicantProfile = NonNullable<
  ReturnType<typeof useApplicantProfile>['data']
>;

function ProfileCard({
  profile,
  resumeUrl,
}: {
  profile?: ApplicantProfile;
  resumeUrl: string | null;
}): ReactElement {
  const school = profile?.school ?? null;
  const graduationYear = profile?.graduationYear ?? null;
  const bio = profile?.bio ?? null;
  const major = profile?.major ?? null;
  const linkedinUrl = profile?.linkedinUrl ?? null;
  const portfolioUrl = profile?.portfolioUrl ?? null;

  const allNull =
    !school && !graduationYear && !bio && !major && !linkedinUrl && !portfolioUrl && !resumeUrl;

  return (
    <div
      data-testid="profile-card"
      className="flex flex-col gap-3 rounded-xl border border-hairline bg-card p-4"
    >
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">
        PROFILE
      </p>

      {allNull ? (
        <p data-testid="profile-empty" className="text-sm text-muted">
          No profile information provided
        </p>
      ) : (
        <dl className="flex flex-col gap-2">
          {school && (
            <ProfileField testid="profile-school" label="School" value={school} />
          )}
          {major && (
            <ProfileField testid="profile-major" label="Major" value={major} />
          )}
          {graduationYear !== null && (
            <ProfileField
              testid="profile-graduation-year"
              label="Graduation year"
              value={String(graduationYear)}
            />
          )}
          {bio && <ProfileField testid="profile-bio" label="Bio" value={bio} />}
          {linkedinUrl && (
            <ProfileLink
              testid="profile-linkedin"
              label="LinkedIn"
              href={linkedinUrl}
            />
          )}
          {portfolioUrl && (
            <ProfileLink
              testid="profile-portfolio"
              label="Portfolio"
              href={portfolioUrl}
            />
          )}
          {resumeUrl && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted">Resume</dt>
              <dd>
                <a
                  data-testid="applicant-resume-link"
                  href={resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary-600 underline hover:text-primary-700"
                >
                  View resume
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function ProfileField({
  testid,
  label,
  value,
}: {
  testid: string;
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd data-testid={testid} className="text-sm text-ink break-words">
        {value}
      </dd>
    </div>
  );
}

function ProfileLink({
  testid,
  label,
  href,
}: {
  testid: string;
  label: string;
  href: string;
}): ReactElement {
  // Defensive scheme guard — only render the anchor when the href is http/https.
  // The server-side check in me.ts is the primary control; this is a secondary
  // defence against values stored before the server-side check was introduced.
  const isSafe = /^https?:\/\//i.test(href);
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd>
        {isSafe ? (
          <a
            data-testid={testid}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary-600 underline break-all hover:text-primary-700"
          >
            {href}
          </a>
        ) : null}
      </dd>
    </div>
  );
}

function PendingRow({
  exp,
  onVerify,
  onFlag,
}: {
  exp: Experience;
  onVerify: () => void;
  onFlag: () => void;
}): ReactElement {
  return (
    <div
      data-testid={`pending-row-${exp.id}`}
      className="rounded-xl border border-primary-500 bg-card px-4 py-3 flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium text-ink">{exp.organization}</p>
        <p className="truncate text-sm text-muted">{exp.position}</p>
      </div>

      {/* Flag affordance — opens the flag modal (UI-101) */}
      <button
        data-testid={`flag-btn-${exp.id}`}
        type="button"
        aria-label="Flag"
        onClick={onFlag}
        className="shrink-0 rounded-lg p-2 text-muted hover:bg-border/20 transition-colors"
      >
        {/* Flag SVG icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M3 2v12M3 2l9 3-9 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Verify button */}
      <button
        data-testid={`verify-btn-${exp.id}`}
        type="button"
        onClick={onVerify}
        className="shrink-0 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-600 transition-colors"
      >
        ✓ Verify
      </button>
    </div>
  );
}

function VerifiedRow({ exp }: { exp: Experience }): ReactElement {
  const dateStr = exp.verifiedAt
    ? new Date(exp.verifiedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div
      data-testid={`verified-row-${exp.id}`}
      className="rounded-xl border border-hairline bg-white px-4 py-3 flex items-center gap-3"
    >
      {/* Success check */}
      <span className="text-success-500 shrink-0" aria-hidden="true">
        ✓
      </span>

      <div className="flex-1 min-w-0">
        <p className="truncate font-medium text-ink">{exp.organization}</p>
        <p className="truncate text-sm text-muted">{exp.position}</p>
      </div>

      <p className="shrink-0 text-xs text-muted tabular-nums">
        Verified by you{dateStr ? ` · ${dateStr}` : ''}
      </p>
    </div>
  );
}
