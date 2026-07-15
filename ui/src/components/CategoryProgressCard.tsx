import { goalMet, goalPercent, exceededBy } from '../lib/goals.js';

interface Props {
  name: string;
  goalHours: number | null;
  hours: number;
  experienceCount: number;
  verifiedCount: number;
}

export function CategoryProgressCard({ name, goalHours, hours, experienceCount, verifiedCount }: Props) {
  const goal = goalHours;
  const met = goalMet(goal, hours);
  const pct = goalPercent(goal, hours);
  const exceeded = exceededBy(goal, hours);

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const tileClass =
    goal !== null
      ? 'bg-primary-100 text-primary-800'
      : 'bg-chip text-ink-soft';

  return (
    <div className="bg-card border border-hairline rounded-[18px] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {/* Initials tile */}
        <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${tileClass}`}>
          {initials}
          {met && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-success-bg flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2 2 4-4" stroke="var(--color-success-fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink text-sm truncate">{name}</div>
          <div className="text-xs text-muted">
            {experienceCount} experience{experienceCount !== 1 ? 's' : ''} · {verifiedCount} verified
          </div>
        </div>

        {/* Status label */}
        {goal !== null && (
          <div className="flex-shrink-0">
            {met ? (
              <span className="text-xs font-semibold text-success-fg">Goal reached</span>
            ) : (
              <span className="text-xs font-semibold text-primary-500">{pct ?? 0}%</span>
            )}
          </div>
        )}
      </div>

      {/* Progress bar (goal-bearing only) */}
      {goal !== null && (
        <div className="h-2 rounded-full bg-track overflow-hidden">
          <div
            className="h-full rounded-full bg-primary-500 transition-all"
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
      )}

      {/* No-goal copy */}
      {goal === null && (
        <p className="text-xs text-muted">No hour minimum for this category</p>
      )}

      {/* Exceeded footer */}
      {met && exceeded !== null && (
        <p className="text-xs text-muted">
          {hours} / {goal} hrs · exceeded by {exceeded}
        </p>
      )}
    </div>
  );
}
