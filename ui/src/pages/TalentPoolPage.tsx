import type { ReactElement } from 'react';
import { useTalentPool } from '../hooks/useTalentPool.js';
import { useReadinessConfig } from '../hooks/useReadinessConfig.js';
import { DEFAULT_READINESS_WEIGHTS } from '../lib/readiness.js';
import { rankTalentPool } from '../components/RisingCandidatesCard.js';
import { getInitials } from '../lib/initials.js';

export function TalentPoolPage(): ReactElement {
  const { data, isLoading } = useTalentPool();
  const { data: weightsData } = useReadinessConfig();
  const weights = weightsData ?? DEFAULT_READINESS_WEIGHTS;

  if (isLoading) {
    return (
      <div className="mx-auto mt-4 max-w-[720px]">
        <div className="h-8 w-48 animate-pulse rounded bg-chip" />
        <ul className="mt-4 flex flex-col gap-2" aria-label="loading">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              data-testid="talent-pool-skeleton"
              className="flex h-14 animate-pulse items-center rounded-xl bg-chip"
            />
          ))}
        </ul>
      </div>
    );
  }

  const ranked = rankTalentPool(data ?? [], weights);

  return (
    <div className="mx-auto mt-4 max-w-[720px]">
      <h1 className="font-display text-2xl font-bold text-ink">Talent pool</h1>
      <p className="mt-1 text-sm text-muted">All granted applicants ranked by application readiness</p>

      {ranked.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[color:var(--color-dashed)] p-8 text-center">
          <p className="text-sm text-muted">No candidates yet</p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {ranked.map((r, i) => {
            const rank = i + 1;
            const isTop = rank === 1;
            return (
              <li
                key={r.entry.applicantUserId}
                data-testid={`talent-pool-rank-${rank}`}
                className={`flex items-center gap-3 rounded-xl border border-hairline px-4 py-3 ${
                  isTop ? 'bg-primary-50' : 'bg-card'
                }`}
              >
                <span className="w-6 shrink-0 font-display text-sm font-bold tabular-nums text-ink">
                  {rank}
                </span>
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-text-inverted"
                >
                  {getInitials(r.entry.applicantName)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {r.entry.applicantName}
                </span>
                <span className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-track">
                  <span
                    className="block h-full rounded-full bg-primary-500"
                    style={{ width: `${r.readiness}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-display text-sm font-bold tabular-nums text-ink">
                  {r.readiness}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
