import type { MilestoneResult } from '../lib/milestones.js';

interface Props {
  milestones: MilestoneResult[];
}

export function MilestoneStrip({ milestones }: Props) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="milestone-strip">
      {milestones.map((m) =>
        m.earned ? (
          <span
            key={m.key}
            data-testid={`milestone-${m.key}`}
            data-earned="true"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-500 text-white text-xs font-semibold"
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path
                d="M2 5l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {m.label}
          </span>
        ) : (
          <span
            key={m.key}
            data-testid={`milestone-${m.key}`}
            data-earned="false"
            className="inline-flex items-center px-3 py-1.5 rounded-full bg-card border border-dashed border-[--color-dashed] text-muted text-xs font-medium"
          >
            {m.label} · {m.remainingLabel}
          </span>
        ),
      )}
    </div>
  );
}
