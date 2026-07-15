import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTalentPool, type TalentPoolEntry } from '../hooks/useTalentPool.js';
import { useReadinessConfig } from '../hooks/useReadinessConfig.js';
import {
  computeReadiness,
  DEFAULT_READINESS_WEIGHTS,
  type ReadinessInput,
  type ReadinessWeights,
} from '../lib/readiness.js';
import { goalForSlug } from '../lib/goals.js';
import { getInitials } from '../lib/initials.js';

/** Number of ranked rows the card surfaces (full list lives on TalentPoolPage). */
const CARD_ROW_LIMIT = 5;

export interface RankedCandidate {
  entry: TalentPoolEntry;
  readiness: number;
}

/**
 * Map a talent-pool entry to the client-side readiness calculator input.
 * Readiness is computed in the UI (D1); no readiness value is read from the API.
 * Goal hours are looked up per category slug via the goals module — the
 * talent-pool response carries no goalHours.
 */
function toReadinessInput(entry: TalentPoolEntry): ReadinessInput {
  const rollup = entry.categories.map((c) => ({
    categoryId: c.categoryId,
    categorySlug: c.categorySlug,
    totalHours: c.totalHours,
  }));

  const experiences: ReadinessInput['experiences'] = [];
  for (const c of entry.categories) {
    const verified = c.verifiedCount;
    const unverified = Math.max(0, c.experienceCount - c.verifiedCount);
    for (let i = 0; i < verified; i += 1) {
      experiences.push({ categoryId: c.categoryId, verificationStatus: 'verified' });
    }
    for (let i = 0; i < unverified; i += 1) {
      experiences.push({ categoryId: c.categoryId, verificationStatus: 'unverified' });
    }
  }

  const activeCategories = entry.categories.map((c) => ({
    id: c.categoryId,
    goalHours: goalForSlug(c.categorySlug),
  }));

  return { rollup, experiences, activeCategories };
}

/**
 * Rank talent-pool entries DESCENDING by computed readiness; ties broken
 * (stably) by applicantName ascending.
 */
export function rankTalentPool(
  entries: TalentPoolEntry[],
  weights: ReadinessWeights,
): RankedCandidate[] {
  return entries
    .map((entry) => ({ entry, readiness: computeReadiness(toReadinessInput(entry), weights) }))
    .sort(
      (a, b) =>
        b.readiness - a.readiness || a.entry.applicantName.localeCompare(b.entry.applicantName),
    );
}

function StarFilled(): ReactElement {
  return (
    <svg
      data-testid="rising-star-filled"
      className="h-4 w-4 text-primary-500"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.1 20.9l1.1-6.5L2.5 9.8l6.5-.9L12 2.5z" />
    </svg>
  );
}

function StarOutline(): ReactElement {
  return (
    <svg
      data-testid="rising-star-outline"
      className="h-4 w-4 text-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.1 20.9l1.1-6.5L2.5 9.8l6.5-.9L12 2.5z" />
    </svg>
  );
}

interface RowProps {
  ranked: RankedCandidate;
  rank: number;
}

function CandidateRow({ ranked, rank }: RowProps): ReactElement {
  const { entry, readiness } = ranked;
  const isTop = rank === 1;
  return (
    <li
      data-testid={`rising-rank-${rank}`}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
        isTop ? 'bg-primary-50' : 'bg-card'
      }`}
    >
      <span className="w-5 shrink-0 font-display text-sm font-bold tabular-nums text-ink">
        {rank}
      </span>
      {isTop ? <StarFilled /> : <StarOutline />}
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-text-inverted"
      >
        {getInitials(entry.applicantName)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
        {entry.applicantName}
      </span>
      <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-track">
        <span
          className="block h-full rounded-full bg-primary-500"
          style={{ width: `${readiness}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right font-display text-sm font-bold tabular-nums text-ink">
        {readiness}%
      </span>
    </li>
  );
}

export function RisingCandidatesCard(): ReactElement {
  const { data, isLoading } = useTalentPool();
  const { data: weightsData } = useReadinessConfig();
  const weights = weightsData ?? DEFAULT_READINESS_WEIGHTS;

  const header = (
    <div className="flex items-start gap-2">
      <StarFilled />
      <div>
        <h2 className="font-display text-[17px] font-bold text-ink">Rising candidates</h2>
        <p className="text-xs text-muted">Highest application readiness this cycle</p>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <section className="rounded-[20px] border border-hairline bg-card p-5">
        {header}
        <ul className="mt-4 flex flex-col gap-2" aria-label="loading">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              data-testid="rising-skeleton"
              className="flex h-12 animate-pulse items-center rounded-xl bg-chip"
            />
          ))}
        </ul>
      </section>
    );
  }

  const ranked = rankTalentPool(data ?? [], weights).slice(0, CARD_ROW_LIMIT);

  if (ranked.length === 0) {
    return (
      <section className="rounded-[20px] border border-hairline bg-card p-5">
        {header}
        <div className="mt-4 rounded-xl border border-dashed border-[color:var(--color-dashed)] p-6 text-center">
          <p className="text-sm text-muted">No candidates yet</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[20px] border border-hairline bg-card p-5">
      {header}
      <ul className="mt-4 flex flex-col gap-1.5">
        {ranked.map((r, i) => (
          <CandidateRow key={r.entry.applicantUserId} ranked={r} rank={i + 1} />
        ))}
      </ul>
      <Link
        to="/mentor/talent-pool"
        data-testid="view-full-talent-pool"
        className="mt-4 block w-full rounded-xl border border-hairline py-2.5 text-center text-sm font-semibold text-ink hover:bg-chip"
      >
        View full talent pool
      </Link>
    </section>
  );
}
