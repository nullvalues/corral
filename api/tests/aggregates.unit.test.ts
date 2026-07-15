import { describe, it, expect } from 'vitest';
import { coerceCount, coerceSum } from '../src/db/aggregates.js';

describe('coerceCount', () => {
  it('coerces a string to number', () => {
    expect(coerceCount('42')).toBe(42);
  });

  it('passes through a number', () => {
    expect(coerceCount(7)).toBe(7);
  });

  it('returns 0 for null', () => {
    expect(coerceCount(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(coerceCount(undefined)).toBe(0);
  });
});

describe('coerceSum', () => {
  it('coerces a decimal string to number', () => {
    expect(coerceSum('123.5')).toBe(123.5);
  });

  it('returns 0 for null', () => {
    expect(coerceSum(null)).toBe(0);
  });

  it('coerces a string integer to number', () => {
    expect(coerceSum('99')).toBe(99);
  });

  it('passes through a number', () => {
    expect(coerceSum(42)).toBe(42);
  });

  it('returns 0 for undefined', () => {
    expect(coerceSum(undefined)).toBe(0);
  });
});
