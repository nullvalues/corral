import { describe, it, expect } from 'vitest';
import { getInitials } from './initials.js';

describe('getInitials', () => {
  it('derives initials from a two-word name', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL');
  });

  it('returns a single char for a single-word name', () => {
    expect(getInitials('Cher')).toBe('C');
  });

  it('handles extra internal whitespace without throwing', () => {
    expect(getInitials('  Ada   Lovelace  ')).toBe('AL');
  });

  it('returns ? for an empty string', () => {
    expect(getInitials('')).toBe('?');
  });

  it('returns ? for whitespace-only input', () => {
    expect(getInitials('   ')).toBe('?');
  });

  it('uses the first character of the first and last word for multi-word names', () => {
    expect(getInitials('Mary Jane Watson')).toBe('MW');
  });
});
