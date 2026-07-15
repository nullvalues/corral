import { useEffect, useRef, useState } from 'react';

/**
 * useMilestoneAward — exactly-once, server-confirmed milestone celebration detector.
 *
 * Input is the SERVER earned-key set (the keys with `earned: true` from
 * useMyMilestones) — so the celebration only fires once the server has confirmed
 * (persisted) a newly-awarded milestone_award row. Replaces the client-debounced
 * localStorage goal-crossing trigger (useGoalCrossing) from PM034.
 *
 * Contract (mirrors useGoalCrossing's anti-false-fire behaviour):
 *  - First observation for a user seeds the baseline silently and returns
 *    `awarded: null` — no celebration for milestones already earned at first load.
 *  - Fires exactly once per newly-earned key: the surfaced key is folded into the
 *    baseline immediately, so re-renders with the same earned set return null.
 *  - The baseline is persisted to localStorage under `asp:ms-awarded:<userId>`, so a
 *    reload after a celebration does not re-fire.
 */
export function useMilestoneAward(userId: string | undefined, earnedKeys: string[]) {
  const [awarded, setAwarded] = useState<string | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    const key = `asp:ms-awarded:${userId}`;
    const stored = localStorage.getItem(key);
    const prev: string[] = JSON.parse(stored ?? 'null') ?? [];
    const prevSet = new Set(prev);

    if (!seededRef.current && stored === null) {
      // First-ever observation for this user: seed baseline silently, never fire.
      localStorage.setItem(key, JSON.stringify(earnedKeys));
      seededRef.current = true;
      return;
    }
    seededRef.current = true;

    const newlyEarned = earnedKeys.find((k) => !prevSet.has(k));
    if (newlyEarned && awarded === null) {
      // Fold into the baseline immediately so it fires exactly once. Milestone
      // awards are append-only, so the baseline only ever grows (union) — it is
      // never shrunk to match a transient/loading earned set, which would let an
      // already-acknowledged key re-fire once the data reloads.
      localStorage.setItem(
        key,
        JSON.stringify(Array.from(new Set([...prev, ...earnedKeys]))),
      );
      setAwarded(newlyEarned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, earnedKeys.join(','), awarded]);

  return { awarded, dismiss: () => setAwarded(null) };
}
