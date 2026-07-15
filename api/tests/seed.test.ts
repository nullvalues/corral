import { describe, it, expect } from 'vitest';
import { CATEGORIES } from '../src/db/seed.js';

describe('seed CATEGORIES', () => {
  it('has exactly 6 entries', () => {
    expect(CATEGORIES).toHaveLength(6);
  });

  it('every slug is unique', () => {
    const slugs = CATEGORIES.map((c) => c.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('every slug matches the allowed pattern', () => {
    const pattern = /^[a-z][a-z0-9-]{0,63}$/;
    for (const { slug } of CATEGORIES) {
      expect(slug).toMatch(pattern);
    }
  });
});
