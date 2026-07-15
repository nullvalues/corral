import { useEffect } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { useCurrentUserId } from '../hooks/useCurrentUserId.js';
import { useMentorContext } from '../layouts/MentorScopeLayout.js';
import { useExperiences } from '../hooks/useExperiences.js';
import type { paths } from '../api-types.js';

type Category =
  paths['/api/experience-categories']['get']['responses'][200]['content']['application/json'][number];

type Experience = {
  id: string;
  categoryId: string;
  [key: string]: unknown;
};

export function ExperiencesPage() {
  const navigate = useNavigate();
  const { slug, applicantUserId } = useParams<{ slug: string; applicantUserId: string }>();
  const mentorCtx = useMentorContext();
  const currentUserId = useCurrentUserId();
  const userId = mentorCtx?.grant.applicantUserId ?? currentUserId;
  const qc = useQueryClient();
  const { data: allExperiences } = useExperiences(userId);

  const { data: allCategories } = useQuery<Category[]>({
    queryKey: queryKeys.categories,
    queryFn: async () => {
      const res = await fetch('/api/experience-categories', { credentials: 'include' });
      if (!res.ok) throw { status: res.status };
      return res.json() as Promise<Category[]>;
    },
  });

  const activeCategories = (allCategories ?? [])
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const basePath = mentorCtx ? `/mentor/${applicantUserId}/experiences` : '/experiences';

  // Redirect to the first active category if no slug in URL
  useEffect(() => {
    if (activeCategories.length > 0 && !slug) {
      navigate(`${basePath}/${activeCategories[0].slug}`, { replace: true });
    }
  }, [activeCategories, slug, navigate, basePath]);

  // Derive counts from locally held data, falling back to the cache
  function countForCategory(categoryId: string): number {
    if (!userId) return 0;
    const source = allExperiences ?? qc.getQueryData<Experience[]>(queryKeys.experiences(userId));
    if (!source) return 0;
    return source.filter((e) => e.categoryId === categoryId).length;
  }

  return (
    <div>
      {/* Mentor context heading — visible when viewing as a mentor on behalf of an applicant */}
      {mentorCtx && (
        <h2 className="px-4 pt-4 pb-2 text-lg font-semibold text-text-default">
          Experiences — {mentorCtx.grant.applicantName}
        </h2>
      )}

      {/* Export affordance — applicant's own view only (mentor-view export depends on API-063) */}
      {!mentorCtx && currentUserId && (
        <div className="flex justify-end px-4 pt-4">
          <button
            type="button"
            onClick={() =>
              window.open(
                `/api/experiences/export?owner_user_id=${encodeURIComponent(currentUserId)}`,
              )
            }
            className="rounded-md border border-surface-muted px-3 py-1.5 text-sm font-medium text-text-default hover:bg-surface-muted"
          >
            Download CSV
          </button>
        </div>
      )}

      {/* Category tab bar */}
      <nav className="flex border-b border-surface-muted" aria-label="Experience categories">
        {activeCategories.map((category) => {
          const isActive = category.slug === slug;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => navigate(`${basePath}/${category.slug}`)}
              className={[
                'px-4 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-b-2 border-primary-700 text-primary-700'
                  : 'text-text-muted hover:text-text-default',
              ].join(' ')}
              aria-current={isActive ? 'page' : undefined}
            >
              {category.name}({countForCategory(category.id)})
            </button>
          );
        })}
      </nav>

      {/* Child route renders here */}
      <Outlet />
    </div>
  );
}
