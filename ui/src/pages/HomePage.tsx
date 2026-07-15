import { useNavigate } from 'react-router-dom';
import { useCurrentUserId } from '../hooks/useCurrentUserId.js';
import { useMe } from '../hooks/useMe.js';
import { useRollup } from '../hooks/useRollup.js';
import { useExperiences } from '../hooks/useExperiences.js';
import { useCategories } from '../hooks/useCategories.js';
import { goalMet } from '../lib/goals.js';
import { computeReadiness, DEFAULT_READINESS_WEIGHTS } from '../lib/readiness.js';
import { useReadinessConfig } from '../hooks/useReadinessConfig.js';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber.js';
import { useMyMilestones } from '../hooks/useMyMilestones.js';
import { useMilestoneAward } from '../hooks/useMilestoneAward.js';
import { ProgressRing } from '../components/ProgressRing.js';
import { CategoryProgressCard } from '../components/CategoryProgressCard.js';
import { MilestoneStrip } from '../components/MilestoneStrip.js';
import { HomeEmptyState } from '../components/HomeEmptyState.js';
import { CelebrationOverlay } from '../components/CelebrationOverlay.js';
import { getInitials } from '../lib/initials.js';

export function HomePage() {
  const navigate = useNavigate();
  const userId = useCurrentUserId();
  const { data: me } = useMe();
  const { data: rollup = [] } = useRollup(userId);
  const { data: experiences, isSuccess } = useExperiences(userId);
  const { data: categories = [] } = useCategories();
  const { data: weights } = useReadinessConfig();

  const active = categories
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const experienceList = experiences ?? [];

  const totalHours = rollup.reduce((s, r) => s + r.totalHours, 0);
  const verifiedCount = experienceList.filter((e) => e.verificationStatus === 'verified').length;
  const hoursByCat = new Map(rollup.map((r) => [r.categoryId, r.totalHours]));

  const goalBearing = active.filter((c) => c.goalHours !== null);
  const goalsMet = goalBearing.filter(
    (c) => goalMet(c.goalHours, hoursByCat.get(c.id) ?? 0),
  ).length;

  // Milestone strip renders from the server (stored milestone_award rows), and the
  // celebration fires when the server confirms a newly-awarded milestone. UI-080.
  const { data: milestones } = useMyMilestones();
  const milestoneList = milestones ?? [];
  const earnedKeys = milestoneList.filter((m) => m.earned).map((m) => m.key);
  const { awarded, dismiss } = useMilestoneAward(userId, earnedKeys);
  const awardedLabel = milestoneList.find((m) => m.key === awarded)?.label ?? '';

  const readiness = computeReadiness(
    {
      rollup,
      experiences: experienceList,
      activeCategories: active.map((c) => ({ id: c.id, goalHours: c.goalHours })),
    },
    weights ?? DEFAULT_READINESS_WEIGHTS,
  );
  const animated = useAnimatedNumber(readiness);

  // Derive initials from user name for avatar
  const userName = me?.user?.name ?? '';
  const initials = getInitials(userName);

  // Empty-state branch: renders first-run screen when experiences have loaded but are empty
  if (isSuccess && experienceList.length === 0) {
    return (
      <HomeEmptyState
        name={userName}
        categories={active.map((c) => ({ id: c.id, name: c.name, goalHours: c.goalHours }))}
        isAdmin={me?.roles.includes('admin') ?? false}
      />
    );
  }

  return (
    <main className="px-[18px] py-4 flex flex-col gap-6">
      {/* Brand row */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary-500 flex items-center justify-center">
          <span className="font-display text-white font-extrabold text-lg leading-none">O</span>
        </div>
        <span className="font-semibold text-ink flex-1">Pre-Vet Portfolio</span>
        <div className="w-9 h-9 rounded-full bg-chip flex items-center justify-center">
          <span className="text-xs font-bold text-ink-soft">{initials}</span>
        </div>
      </div>

      {/* Greeting */}
      <h1 className="font-display text-[22px] font-bold text-ink leading-snug">
        {userName ? `Hey, ${userName.split(' ')[0]}` : 'Welcome back'}
      </h1>

      {/* Hero card */}
      <div className="bg-ink rounded-[22px] p-5 flex flex-col gap-4" data-testid="readiness-hero">
        <p className="text-[10px] tracking-widest font-semibold text-white/50 uppercase">
          Application Readiness
        </p>
        <div className="flex items-center gap-5">
          <ProgressRing value={animated} />
          <div className="flex flex-col gap-1">
            <p className="text-white/70 text-sm">
              Keep adding experiences to reach your goals.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10" />

        {/* 3-up stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center">
            <span className="numeral text-[22px] font-extrabold text-white" data-testid="stat-total-hours">
              {totalHours}
            </span>
            <span className="text-[10px] text-white/50 uppercase tracking-wide">Total hrs</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="numeral text-[22px] font-extrabold text-white" data-testid="stat-verified">
              {verifiedCount}
            </span>
            <span className="text-[10px] text-white/50 uppercase tracking-wide">Verified</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="numeral text-[22px] font-extrabold text-white" data-testid="stat-experiences">
              {experienceList.length}
            </span>
            <span className="text-[10px] text-white/50 uppercase tracking-wide">Experiences</span>
          </div>
        </div>
      </div>

      {/* Categories section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink text-[15px]">Your categories</h2>
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full bg-success-bg text-success-fg"
            data-testid="goals-pill"
          >
            {goalsMet} of {goalBearing.length} goals met
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {active.map((cat) => {
            const catHours = hoursByCat.get(cat.id) ?? 0;
            const catExperiences = experienceList.filter((e) => e.categoryId === cat.id);
            const catVerified = catExperiences.filter(
              (e) => e.verificationStatus === 'verified',
            ).length;
            return (
              <CategoryProgressCard
                key={cat.id}
                name={cat.name}
                goalHours={cat.goalHours}
                hours={catHours}
                experienceCount={catExperiences.length}
                verifiedCount={catVerified}
              />
            );
          })}
        </div>
      </div>

      {/* Milestones section */}
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-[15px]">Milestones</h2>
        <MilestoneStrip milestones={milestoneList} />
      </div>

      {/* Milestone-award celebration overlay — mounts only while awarded !== null */}
      {awarded && (
        <CelebrationOverlay
          categoryName={awardedLabel}
          onShare={() => { dismiss(); navigate('/mentor-status'); }}
          onKeepBuilding={dismiss}
        />
      )}
    </main>
  );
}
