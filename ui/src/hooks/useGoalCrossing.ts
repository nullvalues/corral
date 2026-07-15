import { useEffect, useRef, useState } from 'react';

/**
 * useGoalCrossing — client-debounced goal-crossing detector.
 *
 * Compares the current met-slug set against a localStorage baseline keyed by
 * userId (`asp:goal-met:<userId>`). Surfaces the first newly-crossed slug as
 * `crossed` and folds it into the baseline immediately so it fires exactly once.
 *
 * On first observation for a user (no stored baseline), seeds the baseline with
 * the current met set and returns `crossed: null` — no false celebration on login.
 *
 * PM038 seam: replace the localStorage baseline with a server-confirmed
 * newly-awarded milestone_award row.
 */
export function useGoalCrossing(userId: string | undefined, metSlugs: string[]) {
  const [crossed, setCrossed] = useState<string | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    const key = `asp:goal-met:${userId}`;
    const prev: string[] = JSON.parse(localStorage.getItem(key) ?? 'null') ?? [];
    const prevSet = new Set(prev);

    if (!seededRef.current && localStorage.getItem(key) === null) {
      // First-ever observation for this user: seed baseline silently, never fire.
      localStorage.setItem(key, JSON.stringify(metSlugs));
      seededRef.current = true;
      return;
    }
    seededRef.current = true;

    const newlyMet = metSlugs.find((s) => !prevSet.has(s));
    if (newlyMet && crossed === null) {
      // Record into baseline immediately so it fires exactly once.
      localStorage.setItem(key, JSON.stringify(Array.from(new Set([...prev, ...metSlugs]))));
      setCrossed(newlyMet);
    } else if (metSlugs.length !== prev.length) {
      localStorage.setItem(key, JSON.stringify(metSlugs));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, metSlugs.join(','), crossed]);

  return { crossed, dismiss: () => setCrossed(null) };
}
