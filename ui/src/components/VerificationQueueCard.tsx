import { useState, type ReactElement } from 'react';
import { useVerificationQueue, type QueueRow } from '../hooks/useVerificationQueue.js';
import { useVerifyExperience } from '../hooks/useVerifyExperience.js';
import { useCategories } from '../hooks/useCategories.js';
import { getInitials } from '../lib/initials.js';

/* ------------------------------------------------------------------ */
/* Row sub-component (owns its own mutation so hooks are unconditional) */
/* ------------------------------------------------------------------ */

type RowState = 'idle' | 'optimistic' | 'error';

function QueueRowItem({
  row,
  categoryName,
  isOptimistic,
  onVerified,
  onError,
}: {
  row: QueueRow;
  categoryName: string;
  isOptimistic: boolean;
  onVerified: (id: string, totalHours: number) => void;
  onError: (id: string) => void;
}): ReactElement {
  const { mutate, isPending } = useVerifyExperience(row.applicantUserId);
  const [rowState, setRowState] = useState<RowState>('idle');

  const handleVerify = () => {
    setRowState('optimistic');
    onVerified(row.experience.id, row.experience.totalHours);
    mutate(
      { id: row.experience.id, action: 'verify' },
      {
        onError: () => {
          setRowState('error');
          onError(row.experience.id);
        },
      },
    );
  };

  const verified = rowState === 'optimistic' || isOptimistic;
  const hasError = rowState === 'error';

  return (
    <div
      className={`flex items-center gap-3 py-3 px-1 border-b border-hairline last:border-0 transition-opacity ${
        verified ? 'opacity-40' : 'opacity-100'
      }`}
      data-testid="queue-row"
    >
      {/* Avatar */}
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-ink flex items-center justify-center">
        <span className="text-xs font-semibold text-white">{getInitials(row.applicantName)}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">
          {row.applicantName} · {row.experience.organization}
        </p>
        <p className="text-xs text-muted truncate">
          {categoryName} · {row.experience.totalHours} hrs · {row.experience.position}
        </p>
        {hasError && (
          <p className="text-xs text-danger-500 mt-0.5">Verification failed — please try again.</p>
        )}
      </div>

      {/* Right side: verified or button */}
      {verified ? (
        <div className="flex-shrink-0 flex items-center gap-1.5 text-success-500">
          {/* Green check mark */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="8" fill="currentColor" className="text-success-500" />
            <path
              d="M4.5 8.5 L7 11 L11.5 6"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-xs font-semibold text-success-500">
            +{row.experience.totalHours} hrs
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleVerify}
          disabled={isPending}
          className="flex-shrink-0 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600 active:bg-primary-700 disabled:opacity-50 transition-colors"
          data-testid="verify-button"
        >
          Verify
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main card                                                            */
/* ------------------------------------------------------------------ */

/**
 * B1 verification queue card for the mentor dashboard.
 * Renders all unverified experiences across the mentor's active grants.
 * Tracks a session-local "cleared today" counter for the progress bar.
 * UI-073.
 */
export function VerificationQueueCard(): ReactElement {
  const { isLoading, rows, pendingCount } = useVerificationQueue();
  const { data: categories } = useCategories();

  // Session-local tracking for the optimistic UI
  const [clearedToday, setClearedToday] = useState(0);
  const [optimisticIds, setOptimisticIds] = useState<Set<string>>(new Set());

  const total = clearedToday + pendingCount;
  const barPercent = total > 0 ? Math.round((clearedToday / total) * 100) : 0;

  const handleVerified = (id: string, _totalHours: number) => {
    setClearedToday((c) => c + 1);
    setOptimisticIds((s) => new Set([...s, id]));
  };

  const handleError = (id: string) => {
    setClearedToday((c) => Math.max(0, c - 1));
    setOptimisticIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  };

  const getCategoryName = (categoryId: string): string =>
    categories?.find((c) => c.id === categoryId)?.name ?? '—';

  /* Loading skeleton */
  if (isLoading) {
    return (
      <div className="rounded-2xl bg-card border border-hairline p-5">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-5 bg-chip rounded w-36" />
            <div className="h-5 bg-chip rounded w-16" />
          </div>
          <div className="h-2 bg-chip rounded-full" />
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-chip flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-chip rounded w-3/4" />
                  <div className="h-3 bg-chip rounded w-1/2" />
                </div>
                <div className="h-7 w-14 bg-chip rounded-lg flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* Empty state — no pending and none cleared this session */
  if (rows.length === 0 && clearedToday === 0) {
    return (
      <div className="rounded-2xl bg-card border border-hairline p-6 flex flex-col items-center gap-3 text-center">
        {/* Success check circle */}
        <div className="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 12.5L10 16.5L18 9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-success-700"
            />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-ink" data-testid="empty-state">
            All caught up
          </p>
          <p className="text-sm text-muted mt-0.5">
            No pending verifications right now.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card border border-hairline p-5 flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink text-base">Verification queue</h2>
        {pendingCount > 0 && (
          <span
            className="inline-flex items-center rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-semibold text-primary-700"
            data-testid="waiting-pill"
          >
            {pendingCount} waiting
          </span>
        )}
      </div>

      {/* Progress bar — "N of M cleared today" */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            <span className="font-semibold text-success-700">{clearedToday}</span>
            {' of '}
            <span className="font-semibold text-ink">{total}</span>
            {' cleared today'}
          </p>
          <p className="text-xs text-muted">{barPercent}%</p>
        </div>
        {/* Track */}
        <div className="h-2 rounded-full bg-track overflow-hidden">
          <div
            className="h-full rounded-full bg-success-500 transition-all duration-300"
            style={{ width: `${barPercent}%` }}
            data-testid="progress-bar"
          />
        </div>
      </div>

      {/* Rows */}
      <div>
        {rows.map((row) => (
          <QueueRowItem
            key={row.experience.id}
            row={row}
            categoryName={getCategoryName(row.experience.categoryId)}
            isOptimistic={optimisticIds.has(row.experience.id)}
            onVerified={handleVerified}
            onError={handleError}
          />
        ))}

        {/* All caught up inline (when queue is empty after some clearings) */}
        {rows.length === 0 && clearedToday > 0 && (
          <p className="text-sm text-muted text-center py-3" data-testid="empty-state">
            All caught up — nice work!
          </p>
        )}
      </div>
    </div>
  );
}
