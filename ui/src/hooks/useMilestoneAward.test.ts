/**
 * useMilestoneAward — server-confirmed single-fire contract tests (TEST-054 / UI-080).
 *
 * Asserts:
 *  1. First observation for a fresh user seeds the baseline silently (awarded: null)
 *     — no celebration for milestones already earned at first load.
 *  2. When a new server-earned key enters the set, `awarded` becomes that key exactly once.
 *  3. A re-render with the same earned set after dismiss() returns awarded: null.
 *  4. The surfaced key is folded into the localStorage baseline immediately.
 *  5. A simulated reload with the same earned set does not re-fire (baseline persisted
 *     under asp:ms-awarded:<userId>).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useMilestoneAward } from './useMilestoneAward.js';

const UID = 'u1';
const KEY = `asp:ms-awarded:${UID}`;

describe('useMilestoneAward', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('seeds the baseline silently on first observation and returns awarded: null', () => {
    const { result } = renderHook(
      ({ keys }: { keys: string[] }) => useMilestoneAward(UID, keys),
      { initialProps: { keys: ['first_experience'] } },
    );

    expect(result.current.awarded).toBeNull();

    const stored: string[] = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toEqual(['first_experience']);
  });

  it('surfaces the first newly-earned key exactly once', () => {
    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useMilestoneAward(UID, keys),
      { initialProps: { keys: ['first_experience'] } },
    );

    expect(result.current.awarded).toBeNull();

    rerender({ keys: ['first_experience', 'hours_100'] });
    expect(result.current.awarded).toBe('hours_100');
  });

  it('does not re-fire after dismiss() — re-render with same earned set returns null', () => {
    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useMilestoneAward(UID, keys),
      { initialProps: { keys: ['first_experience'] } },
    );

    rerender({ keys: ['first_experience', 'hours_100'] });
    expect(result.current.awarded).toBe('hours_100');

    act(() => result.current.dismiss());

    rerender({ keys: ['first_experience', 'hours_100'] });
    expect(result.current.awarded).toBeNull();
  });

  it('folds the surfaced key into the localStorage baseline immediately', () => {
    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useMilestoneAward(UID, keys),
      { initialProps: { keys: ['first_experience'] } },
    );

    rerender({ keys: ['first_experience', 'hours_100'] });
    expect(result.current.awarded).toBe('hours_100');

    const stored: string[] = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toContain('hours_100');
  });

  it('does not re-fire on a simulated reload when the key is already in the baseline', () => {
    localStorage.setItem(KEY, JSON.stringify(['first_experience', 'hours_100']));

    const { result } = renderHook(
      ({ keys }: { keys: string[] }) => useMilestoneAward(UID, keys),
      { initialProps: { keys: ['first_experience', 'hours_100'] } },
    );

    expect(result.current.awarded).toBeNull();
  });

  it('is server-confirmed: only keys present in the earned set surface', () => {
    // Pre-seed a baseline so this is not the first observation.
    localStorage.setItem(KEY, JSON.stringify(['first_experience']));

    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useMilestoneAward(UID, keys),
      { initialProps: { keys: ['first_experience'] } },
    );

    // No new server-earned key yet.
    expect(result.current.awarded).toBeNull();

    // The server now confirms a new award.
    rerender({ keys: ['first_experience', 'hours_500'] });
    expect(result.current.awarded).toBe('hours_500');
  });
});
