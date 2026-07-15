import { useEffect, useRef, useState } from 'react';

/**
 * rAF count-up hook: ramps from 0 to `target` on mount (ease-out cubic),
 * settling exactly on `target`. Restarts when `target` (or `durationMs`)
 * changes. Source for the readiness ring's 0→value animation (UI-064).
 */
export function useAnimatedNumber(target: number, durationMs = 600): number {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    startRef.current = null;
    let raf = 0;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}
