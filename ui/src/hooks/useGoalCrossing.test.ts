/**
 * useGoalCrossing — debounce contract tests.
 *
 * Asserts:
 *  1. First observation for a fresh user (empty localStorage) seeds the baseline
 *     and returns crossed: null (no false celebration on login).
 *  2. When a new slug enters the met set, `crossed` becomes that slug exactly once.
 *  3. A subsequent re-render with the same met set (after dismiss) returns crossed: null.
 *  4. After dismiss(), the baseline contains the crossed slug so it does not re-fire
 *     on a subsequent render (including simulated page reloads).
 *  5. The baseline is read from / written to localStorage under `asp:goal-met:<userId>`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useGoalCrossing } from './useGoalCrossing.js';

const UID = 'u1';
const KEY = `asp:goal-met:${UID}`;

describe('useGoalCrossing', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('seeds the baseline silently on first observation and returns crossed: null', () => {
    const { result } = renderHook(
      ({ slugs }: { slugs: string[] }) => useGoalCrossing(UID, slugs),
      { initialProps: { slugs: ['healthcare-experience'] } },
    );

    // No celebration fires on first load, even when goals are already met
    expect(result.current.crossed).toBeNull();

    // Baseline was written with the current met set
    const stored: string[] = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toEqual(['healthcare-experience']);
  });

  it('surfaces the first newly-crossed slug exactly once', () => {
    const { result, rerender } = renderHook(
      ({ slugs }: { slugs: string[] }) => useGoalCrossing(UID, slugs),
      { initialProps: { slugs: ['healthcare-experience'] } },
    );

    // First observation seeds baseline silently
    expect(result.current.crossed).toBeNull();

    // A new slug enters the met set
    rerender({ slugs: ['healthcare-experience', 'volunteer-experience'] });
    expect(result.current.crossed).toBe('volunteer-experience');
  });

  it('does not re-fire after dismiss() — re-render with same met set returns crossed: null', () => {
    const { result, rerender } = renderHook(
      ({ slugs }: { slugs: string[] }) => useGoalCrossing(UID, slugs),
      { initialProps: { slugs: ['healthcare-experience'] } },
    );

    rerender({ slugs: ['healthcare-experience', 'volunteer-experience'] });
    expect(result.current.crossed).toBe('volunteer-experience');

    act(() => result.current.dismiss());

    // Same met set on re-render does not re-fire after dismiss
    rerender({ slugs: ['healthcare-experience', 'volunteer-experience'] });
    expect(result.current.crossed).toBeNull();
  });

  it('records the crossed slug into the localStorage baseline immediately', () => {
    const { result, rerender } = renderHook(
      ({ slugs }: { slugs: string[] }) => useGoalCrossing(UID, slugs),
      { initialProps: { slugs: ['healthcare-experience'] } },
    );

    rerender({ slugs: ['healthcare-experience', 'volunteer-experience'] });
    expect(result.current.crossed).toBe('volunteer-experience');

    act(() => result.current.dismiss());

    // The crossed slug is now in the baseline
    const stored: string[] = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toContain('volunteer-experience');
  });

  it('does not re-fire on a simulated page reload with the same met set (baseline already contains slug)', () => {
    // Simulate a previous session that crossed and dismissed volunteer-experience
    const existingBaseline = ['healthcare-experience', 'volunteer-experience'];
    localStorage.setItem(KEY, JSON.stringify(existingBaseline));

    // Re-mount the hook (page reload) with the same met slugs
    const { result } = renderHook(
      ({ slugs }: { slugs: string[] }) => useGoalCrossing(UID, slugs),
      {
        initialProps: { slugs: ['healthcare-experience', 'volunteer-experience'] },
      },
    );

    // No celebration fires — both slugs were already in the baseline
    expect(result.current.crossed).toBeNull();
  });

  it('reads and writes the baseline under the per-user key (asp:goal-met:<userId>)', () => {
    const { result, rerender } = renderHook(
      ({ slugs }: { slugs: string[] }) => useGoalCrossing(UID, slugs),
      { initialProps: { slugs: [] as string[] } },
    );

    // Baseline is seeded for a user with no goals met yet
    expect(localStorage.getItem(KEY)).not.toBeNull();

    // A new slug crosses
    rerender({ slugs: ['healthcare-experience'] });
    expect(result.current.crossed).toBe('healthcare-experience');

    // The per-user key now reflects the recorded met set
    const stored: string[] = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toContain('healthcare-experience');
  });
});
