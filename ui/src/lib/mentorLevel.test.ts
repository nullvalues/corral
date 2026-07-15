import { describe, expect, it } from 'vitest';
import { mentorLevel, PLATINUM_HOURS, hoursToNextLevel } from './mentorLevel.js';

describe('mentorLevel', () => {
  it('returns Gold for 0 lifetime hours', () => {
    expect(mentorLevel(0)).toBe('Gold');
  });

  it('returns Gold for hours below the Platinum threshold', () => {
    expect(mentorLevel(999)).toBe('Gold');
  });

  it('returns Platinum at exactly 1000 lifetime hours', () => {
    expect(mentorLevel(1000)).toBe('Platinum');
  });

  it('returns Platinum above 1000 lifetime hours', () => {
    expect(mentorLevel(2500)).toBe('Platinum');
  });

  // TEST-054: boundary assertions via PLATINUM_HOURS constant
  it('returns Gold for PLATINUM_HOURS - 1', () => {
    expect(mentorLevel(PLATINUM_HOURS - 1)).toBe('Gold');
  });

  it('returns Platinum at exactly PLATINUM_HOURS', () => {
    expect(mentorLevel(PLATINUM_HOURS)).toBe('Platinum');
  });

  // API-063: custom platinumHours parameter
  it('returns Platinum at 500+ hours when platinumHours = 500', () => {
    expect(mentorLevel(500, 500)).toBe('Platinum');
    expect(mentorLevel(499, 500)).toBe('Gold');
  });

  it('no-arg call still uses 1000 threshold (backward compat)', () => {
    expect(mentorLevel(999)).toBe('Gold');
    expect(mentorLevel(1000)).toBe('Platinum');
  });
});

describe('hoursToNextLevel (TEST-054)', () => {
  it('returns PLATINUM_HOURS - 680 for 680 lifetime hours', () => {
    expect(hoursToNextLevel(680)).toBe(PLATINUM_HOURS - 680);
  });

  it('returns null at exactly PLATINUM_HOURS (Platinum reached)', () => {
    expect(hoursToNextLevel(PLATINUM_HOURS)).toBeNull();
  });

  it('returns null above PLATINUM_HOURS', () => {
    expect(hoursToNextLevel(PLATINUM_HOURS + 100)).toBeNull();
  });

  it('returns PLATINUM_HOURS for 0 lifetime hours', () => {
    expect(hoursToNextLevel(0)).toBe(PLATINUM_HOURS);
  });

  // API-063: custom platinumHours parameter
  it('uses custom platinumHours when provided', () => {
    expect(hoursToNextLevel(300, 500)).toBe(200);
    expect(hoursToNextLevel(500, 500)).toBeNull();
    expect(hoursToNextLevel(600, 500)).toBeNull();
  });

  it('no-arg call still uses 1000 threshold (backward compat)', () => {
    expect(hoursToNextLevel(0)).toBe(1000);
    expect(hoursToNextLevel(1000)).toBeNull();
  });
});
