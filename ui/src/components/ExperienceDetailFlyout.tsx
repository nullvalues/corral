import type { paths } from '../api-types.js';
import { useMentorContext } from '../layouts/MentorScopeLayout.js';
import { useVerifyExperience } from '../hooks/useVerifyExperience.js';

type Experience =
  paths['/api/experiences']['get']['responses'][200]['content']['application/json'][number];

interface Props {
  experience: Experience | null;
  onClose: () => void;
}

function AttestationChip({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <span className={on
      ? 'rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success-fg'
      : 'rounded-full bg-chip px-2.5 py-1 text-xs text-muted'}>
      {on ? onLabel : offLabel}
    </span>
  );
}

export function VerificationBadge({ status }: { status: string }) {
  const verified = status === 'verified';
  return (
    <span
      data-testid="verification-badge"
      className={
        verified
          ? 'inline-flex items-center rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-fg'
          : 'inline-flex items-center rounded-full bg-pending-bg px-2 py-0.5 text-xs font-medium text-pending-fg'
      }
    >
      {verified ? '✓ Verified' : 'Pending verification'}
    </span>
  );
}

function ProvenanceChip({ status, verifiedAt }: { status: string; verifiedAt: string | null }) {
  const verified = status === 'verified';
  return (
    <span
      data-testid="verification-badge"
      className={
        verified
          ? 'mt-2 inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success-fg'
          : 'mt-2 inline-flex items-center gap-1 rounded-full bg-pending-bg px-2.5 py-0.5 text-xs font-medium text-pending-fg'
      }
    >
      {verified
        ? `✓ Verified${verifiedAt ? ` · ${new Date(verifiedAt).toLocaleDateString()}` : ''}`
        : 'Pending verification'}
    </span>
  );
}

export function ExperienceDetailFlyout({ experience, onClose }: Props) {
  const mentorCtx = useMentorContext();
  const canVerify = mentorCtx?.grant.permissions.includes('write') ?? false;
  const verifyMutation = useVerifyExperience(experience?.ownerUserId ?? '');

  if (!experience) return null;

  const contactName = [experience.contactFirstName, experience.contactLastName]
    .filter(Boolean)
    .join(' ') || '—';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-card sm:inset-y-0 sm:left-auto sm:right-0 sm:w-96 sm:border-l sm:border-hairline sm:shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-chip text-ink">←</button>
      </div>

      {/* Title + provenance + stats */}
      <div className="px-4">
        <h2 className="font-display text-[22px] font-bold text-ink">{experience.organization ?? '—'}</h2>
        <p className="text-sm text-muted">{experience.position ?? '—'}</p>
        <ProvenanceChip status={experience.verificationStatus} verifiedAt={experience.verifiedAt} />

        {/* 3-up hours */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-ink p-3 text-text-inverted">
            <div className="font-display text-xl font-extrabold tabular-nums">{experience.totalHours}</div>
            <div className="text-[10px] text-faint">total hrs</div>
          </div>
          <div className="rounded-xl border border-hairline bg-card p-3">
            <div className="font-display text-xl font-extrabold tabular-nums text-ink">{experience.hoursPerWeek}</div>
            <div className="text-[10px] text-muted">hrs/week</div>
          </div>
          <div className="rounded-xl border border-hairline bg-card p-3">
            <div className="font-display text-xl font-extrabold tabular-nums text-ink">{experience.numberOfWeeks}</div>
            <div className="text-[10px] text-muted">weeks</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-faint tabular-nums">
          {experience.startDate ?? '—'} – {experience.endDate ?? 'Ongoing'} · Frequency: {experience.frequency ?? '—'}
        </p>
      </div>

      <div className="mt-4 space-y-4 px-4 pb-8 text-sm">
        {/* Duties */}
        <section>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">DUTIES</p>
          <div className="rounded-xl bg-app-bg p-3 text-[13px] text-ink whitespace-pre-wrap">
            {experience.dutiesNarrative ?? '—'}
          </div>
        </section>

        {/* Location */}
        <section>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">LOCATION</p>
          <dl className="space-y-1">
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 text-muted">State / Province</dt>
              <dd className="text-ink">{experience.stateProvince ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 text-muted">Country</dt>
              <dd className="text-ink">{experience.country ?? '—'}</dd>
            </div>
          </dl>
        </section>

        {/* Attestations */}
        <section>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">ATTESTATIONS</p>
          <div className="flex flex-wrap gap-2">
            <AttestationChip on={experience.isCurrent} onLabel="✓ Currently active" offLabel="Not current" />
            <AttestationChip on={experience.receivedAcademicCredit} onLabel="✓ Academic credit" offLabel="No academic credit" />
            <AttestationChip on={experience.receivedSalaryOrPayment} onLabel="✓ Paid" offLabel="Unpaid" />
            <AttestationChip on={experience.isVolunteer} onLabel="✓ Volunteer" offLabel="Not volunteer" />
            <AttestationChip on={experience.isMostImportant} onLabel="✓ Most important" offLabel="Not flagged" />
            <AttestationChip on={experience.permissionToContact} onLabel="✓ OK to contact" offLabel="No contact" />
          </div>
        </section>

        {/* Verifying contact */}
        <section>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">VERIFYING CONTACT</p>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chip text-xs font-bold text-ink">
              {[experience.contactFirstName?.[0], experience.contactLastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'}
            </span>
            <div>
              <p className="font-medium text-ink">{contactName}</p>
              <p className="text-xs text-muted">
                {[experience.contactTitle, experience.contactEmail].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
          </div>
        </section>

        {/* Mentor verify / un-verify — logic frozen */}
        {canVerify && (
          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">VERIFICATION</p>
            {experience.verificationStatus === 'verified' ? (
              <button
                type="button"
                disabled={verifyMutation.isPending}
                onClick={() => verifyMutation.mutate({ id: experience.id, action: 'unverify' })}
                className="rounded-xl border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-chip disabled:opacity-50"
              >
                Un-verify experience
              </button>
            ) : (
              <button
                type="button"
                disabled={verifyMutation.isPending}
                onClick={() => verifyMutation.mutate({ id: experience.id, action: 'verify' })}
                className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-text-inverted hover:bg-primary-600 disabled:opacity-50"
              >
                Verify experience
              </button>
            )}
            {verifyMutation.isError && (
              <p className="mt-2 text-xs text-danger-700">Could not update verification. Try again.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
