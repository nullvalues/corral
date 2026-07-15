import type { ReactElement } from 'react';
import { useMentorImpact } from '../hooks/useMentorImpact.js';
import { useReadinessConfig } from '../hooks/useReadinessConfig.js';
import { mentorLevel } from '../lib/mentorLevel.js';
import { VerificationQueueCard } from '../components/VerificationQueueCard.js';

export function MentorDashboardPage(): ReactElement {
  const { data, isLoading, isError } = useMentorImpact();
  const { data: config } = useReadinessConfig();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="font-display text-2xl font-bold text-ink">Mentor dashboard</h1>

      {/* Impact hero + stat grid — UI-072 */}
      <section data-testid="mentor-impact-region">
        <ImpactRegion data={data} isLoading={isLoading} isError={isError} platinumHours={config?.platinumHours ?? 1000} />
      </section>

      {/* Verification queue card — UI-073 */}
      <section data-testid="mentor-queue-region">
        <VerificationQueueCard />
      </section>
    </div>
  );
}

/* ---------- sub-components ---------- */

type ImpactData = {
  monthHoursVerified: number;
  lifetimeHoursVerified: number;
  applicantsMentored: number;
  avgTurnaroundHours: number | null;
  streakDays: number;
  pendingVerifications: number;
} | undefined;

function ImpactRegion({
  data,
  isLoading,
  isError,
  platinumHours,
}: {
  data: ImpactData;
  isLoading: boolean;
  isError: boolean;
  platinumHours: number;
}): ReactElement {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {/* Hero skeleton */}
        <div className="animate-pulse rounded-2xl bg-ink/20 h-44" />
        {/* Grid skeleton */}
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-2xl bg-ink/10 h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-muted text-sm">
        Unable to load impact data. Please try refreshing the page.
      </p>
    );
  }

  const level = mentorLevel(data.lifetimeHoursVerified, platinumHours);

  return (
    <div className="flex flex-col gap-4">
      {/* Impact hero card — ink (near-black) background */}
      <div className="rounded-2xl bg-ink p-6 flex flex-col gap-4">
        {/* Eyebrow */}
        <p className="text-xs font-semibold tracking-widest text-primary-500 uppercase">
          YOUR IMPACT THIS MONTH
        </p>

        {/* Large month hours numeral */}
        <p className="font-display text-6xl font-bold text-white tabular-nums leading-none">
          {data.monthHoursVerified}
        </p>
        <p className="text-sm text-white/60">hours verified this month</p>

        {/* Two glass stat tiles */}
        <div className="grid grid-cols-2 gap-3 mt-2">
          {/* Streak tile */}
          <div className="rounded-xl bg-white/10 px-4 py-3 flex flex-col gap-1">
            <p className="font-display text-2xl font-bold text-white tabular-nums leading-none">
              {data.streakDays}
            </p>
            <p className="text-xs text-white/70">day streak</p>
          </div>

          {/* Level tile — NO rank / "Top 5%" text */}
          <div className="rounded-xl bg-white/10 px-4 py-3 flex flex-col gap-1">
            <p className="font-display text-2xl font-bold text-white leading-none">
              {level}
            </p>
            <p className="text-xs text-white/70">mentor level</p>
          </div>
        </div>
      </div>

      {/* 4-up stat grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Applicants mentored"
          value={String(data.applicantsMentored)}
          accent={false}
        />
        <StatCard
          label="Pending verifications"
          value={String(data.pendingVerifications)}
          accent={true}
        />
        <StatCard
          label="Avg turnaround"
          value={data.avgTurnaroundHours !== null ? String(data.avgTurnaroundHours) : '—'}
          accent={false}
        />
        <StatCard
          label="Lifetime hrs verified"
          value={String(data.lifetimeHoursVerified)}
          accent={false}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: boolean;
}): ReactElement {
  return (
    <div className="rounded-2xl bg-card border border-border/40 px-4 py-4 flex flex-col gap-1">
      <p
        className={
          accent
            ? 'font-display text-3xl font-bold tabular-nums text-primary-500 leading-none'
            : 'font-display text-3xl font-bold tabular-nums text-ink leading-none'
        }
      >
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
