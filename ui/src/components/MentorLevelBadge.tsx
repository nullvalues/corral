import type { ReactElement } from 'react';
import { useMentorImpact } from '../hooks/useMentorImpact.js';
import { useReadinessConfig } from '../hooks/useReadinessConfig.js';
import { mentorLevel, hoursToNextLevel } from '../lib/mentorLevel.js';

/**
 * Private mentor level badge — Gold / Platinum from the mentor's own
 * lifetime verified hours (D6). Private to the mentor; no cross-mentor
 * comparison of any kind. Renders inside the MentorWorkspaceLayout sidebar
 * level-card slot.
 *
 * platinumHours is read from useReadinessConfig() so operators can change the
 * threshold without a redeploy (API-063). Falls back to 1000 while loading.
 */
export function MentorLevelBadge(): ReactElement | null {
  const { data, isLoading } = useMentorImpact();
  const { data: config } = useReadinessConfig();
  const platinumHours = config?.platinumHours ?? 1000;

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        className="h-16 rounded-lg bg-white/5 animate-pulse"
      />
    );
  }

  if (!data) return null;

  const hours = data.lifetimeHoursVerified ?? 0;
  const level = mentorLevel(hours, platinumHours);
  const remaining = hoursToNextLevel(hours, platinumHours);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary-500 px-2 py-0.5 text-xs font-semibold text-white">
          {level} mentor
        </span>
      </div>
      <p className="font-display tabular-nums text-xl font-bold leading-none text-white">
        {hours}
        <span className="ml-1 text-xs font-normal text-white/50">hrs</span>
      </p>
      {remaining !== null ? (
        <p className="text-xs text-white/50">
          {remaining} hrs to Platinum
        </p>
      ) : (
        <p className="text-xs font-medium text-primary-400">Top tier</p>
      )}
    </div>
  );
}
