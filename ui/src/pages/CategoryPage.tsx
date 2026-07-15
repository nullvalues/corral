import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { useCurrentUserId } from '../hooks/useCurrentUserId.js';
import { useMentorContext } from '../layouts/MentorScopeLayout.js';
import { useMe } from '../hooks/useMe.js';
import { useExperiences } from '../hooks/useExperiences.js';
import { useRollup } from '../hooks/useRollup.js';
import type { paths } from '../api-types.js';
import { ExperienceDetailFlyout } from '../components/ExperienceDetailFlyout.js';
import { ExperienceForm } from '../components/ExperienceForm.js';
import { Modal } from '../components/Modal.js';
import { useDeleteExperience } from '../hooks/useDeleteExperience.js';
import { goalMet } from '../lib/goals.js';

type Category =
  paths['/api/experience-categories']['get']['responses'][200]['content']['application/json'][number];

type Experience =
  paths['/api/experiences']['get']['responses'][200]['content']['application/json'][number];

export function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const mentorCtx = useMentorContext();
  const { data: meData } = useMe();
  const currentUserId = useCurrentUserId();
  const userId = mentorCtx?.grant.applicantUserId ?? currentUserId;
  const isAdmin = meData?.roles?.includes('admin') ?? false;
  const canWrite = !isAdmin && (mentorCtx ? mentorCtx.grant.permissions.includes('write') : true);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  // null = closed, 'create' = new experience form, string = experienceId for edit
  const [formMode, setFormMode] = useState<null | 'create' | string>(null);

  const { data: allCategories } = useQuery<Category[]>({
    queryKey: queryKeys.categories,
    // Data is already fetched by ExperiencesPage — this call hits the cache.
    // queryFn is required by React Query even when data is pre-populated.
    queryFn: async () => {
      const res = await fetch('/api/experience-categories', { credentials: 'include' });
      if (!res.ok) throw { status: res.status };
      return res.json() as Promise<Category[]>;
    },
  });

  const activeCategory = (allCategories ?? []).find((c) => c.slug === slug);

  const {
    data: experiences,
    isLoading,
    isError,
    refetch,
  } = useExperiences(userId);

  const { data: rollup } = useRollup(userId);
  const deleteMutation = useDeleteExperience(userId ?? '');

  if (isLoading) {
    return (
      <div className="mx-auto mt-4 max-w-[640px]">
        <div className="h-32 animate-pulse rounded-[20px] bg-ink/80" />
        <ul className="mt-4 flex flex-col gap-3" aria-label="loading">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              data-testid="experience-card-skeleton"
              className="animate-pulse rounded-2xl border border-hairline bg-card p-4"
            >
              <div className="h-4 w-32 rounded bg-chip" />
              <div className="mt-2 h-3 w-24 rounded bg-chip" />
              <div className="mt-3 flex gap-2">
                <div className="h-5 w-14 rounded bg-chip" />
                <div className="h-5 w-14 rounded bg-chip" />
                <div className="h-5 w-14 rounded bg-chip" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto mt-6 max-w-[640px] rounded-2xl border border-hairline bg-card p-5 text-sm text-muted">
        Failed to load.{' '}
        <button
          type="button"
          onClick={() => void refetch()}
          className="font-medium text-primary-600 underline hover:no-underline"
        >
          Retry?
        </button>
      </div>
    );
  }

  const categoryExperiences: Experience[] = activeCategory
    ? (experiences ?? []).filter((e) => e.categoryId === activeCategory.id)
    : [];

  const categoryRollup = rollup?.find((r) => r.categoryId === activeCategory?.id);

  const handleFormSuccess = () => {
    setFormMode(null);
  };

  const handleFormCancel = () => {
    setFormMode(null);
  };

  const handleDelete = (exp: Experience) => {
    const confirmed = window.confirm(
      `Delete "${exp.organization} — ${exp.position}"? This cannot be undone.`,
    );
    if (confirmed) {
      void deleteMutation.mutate(exp.id);
    }
  };

  if (categoryExperiences.length === 0) {
    return (
      <>
        <div className="mx-auto mt-6 max-w-[640px]">
          <div className="rounded-2xl border border-dashed border-[color:var(--color-dashed)] bg-card p-8 text-center">
            <p className="font-display text-[17px] font-bold text-ink">
              No experiences in this category yet.
            </p>
            <p className="mt-1 text-sm text-muted">Your first one starts the climb.</p>
            {canWrite && (
              <button
                type="button"
                onClick={() => setFormMode('create')}
                className="mt-4 rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-text-inverted hover:bg-primary-600"
              >
                Add your first experience
              </button>
            )}
          </div>
        </div>

        {/* keep the existing formMode Modal + ExperienceForm block unchanged */}
        {formMode !== null && activeCategory && userId && (
          <Modal
            title={formMode === 'create' ? 'Add Experience' : 'Edit Experience'}
            onClose={handleFormCancel}
          >
            <ExperienceForm
              categoryId={activeCategory.id}
              ownerUserId={userId}
              experienceId={formMode === 'create' ? undefined : formMode}
              onSuccess={handleFormSuccess}
              onCancel={handleFormCancel}
            />
          </Modal>
        )}
      </>
    );
  }

  const verifiedCount = categoryExperiences.filter(
    (e) => e.verificationStatus === 'verified',
  ).length;
  const pendingCount = categoryExperiences.length - verifiedCount;
  // Display-only progress bar. The hero bar is a fixed full proportion here —
  // per-category goal tracking renders on the homepage via CategoryProgressCard.
  const fillPct = 100;

  return (
    <>
      <div className="mx-auto mt-4 max-w-[640px]">
        {/* Category hero */}
        <section className="rounded-[20px] bg-ink p-5 text-text-inverted">
          <h2 className="font-display text-xl font-bold">{activeCategory?.name}</h2>
          <div className="mt-3 font-display text-[42px] font-extrabold tabular-nums leading-none">
            {categoryRollup?.totalHours ?? 0}
            <span className="ml-2 align-middle text-sm font-normal text-faint">hours logged</span>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-track/30">
            <div className="h-2 rounded-full bg-primary-500" style={{ width: `${fillPct}%` }} />
          </div>
        </section>

        {/* Count row */}
        <div className="mt-4 flex items-baseline justify-between">
          <span className="font-display text-[15px] font-bold text-ink">
            {categoryExperiences.length} experiences
          </span>
          <span className="text-xs text-muted tabular-nums">
            {verifiedCount} verified · {pendingCount} pending
          </span>
        </div>

        {/* Cards */}
        <ul className="mt-3 flex flex-col gap-3">
          {categoryExperiences.map((exp) => (
            <li key={exp.id}>
              <div
                data-testid="experience-card"
                role="button"
                tabIndex={0}
                onClick={() => setDetailsId(exp.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setDetailsId(exp.id);
                }}
                className="cursor-pointer rounded-2xl border border-hairline bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-[14.5px] font-bold text-ink">
                      {exp.organization}
                    </div>
                    <div className="text-[12.5px] text-muted">{exp.position}</div>
                  </div>
                  <StatusChip status={exp.verificationStatus} />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(activeCategory?.goalHours !== null && activeCategory?.goalHours !== undefined && !goalMet(activeCategory.goalHours, exp.totalHours)) ? (
                    <span
                      className="hours-below-threshold rounded-md bg-chip px-2 py-0.5 text-xs tabular-nums"
                      data-testid="hours-below-threshold"
                      title="Below VMCAS minimum"
                    >
                      {exp.totalHours} hrs
                    </span>
                  ) : (
                    <span className="rounded-md bg-chip px-2 py-0.5 text-xs tabular-nums">
                      {exp.totalHours} hrs
                    </span>
                  )}
                  <span className="rounded-md bg-chip px-2 py-0.5 text-xs tabular-nums">
                    {exp.hoursPerWeek} hr/wk
                  </span>
                  <span className="rounded-md bg-chip px-2 py-0.5 text-xs tabular-nums">
                    {exp.numberOfWeeks} wks
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-faint tabular-nums">
                    {exp.startDate} –{' '}
                    <span>{exp.isCurrent ? 'Ongoing' : (exp.endDate ?? 'N/A')}</span>
                  </span>
                  {canWrite && (
                    <span className="flex gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFormMode(exp.id);
                        }}
                        className="text-xs font-medium text-primary-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(exp);
                        }}
                        className="text-xs font-medium text-danger-700 hover:underline"
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {canWrite && (
        <button
          type="button"
          onClick={() => setFormMode('create')}
          className="fixed bottom-20 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary-500 px-5 py-3 text-sm font-semibold text-text-inverted shadow-[0_10px_24px_rgba(255,115,0,0.4)] hover:bg-primary-600"
        >
          + Add
        </button>
      )}

      <ExperienceDetailFlyout
        experience={experiences?.find((e) => e.id === detailsId) ?? null}
        onClose={() => setDetailsId(null)}
      />

      {formMode !== null && activeCategory && userId && (
        <Modal
          title={formMode === 'create' ? 'Add Experience' : 'Edit Experience'}
          onClose={handleFormCancel}
        >
          <ExperienceForm
            categoryId={activeCategory.id}
            ownerUserId={userId}
            experienceId={formMode === 'create' ? undefined : formMode}
            onSuccess={handleFormSuccess}
            onCancel={handleFormCancel}
          />
        </Modal>
      )}
    </>
  );
}

function StatusChip({ status }: { status: string }) {
  const verified = status === 'verified';
  return (
    <span
      data-testid="verification-badge"
      className={
        verified
          ? 'inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-fg'
          : 'inline-flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-xs font-medium text-pending-fg'
      }
    >
      {verified ? '✓ Verified' : '◷ Pending'}
    </span>
  );
}
