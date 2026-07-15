// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('../index.css', import.meta.url)),
  'utf8',
);
const html = readFileSync(
  fileURLToPath(new URL('../../index.html', import.meta.url)),
  'utf8',
);

// Normalise for comparison: upper-case (so #ff7300 and #FF7300 both match) AND
// collapse internal whitespace runs to a single space. The latter makes the
// assertions tolerant of column-aligned token declarations — UI-053 ships e.g.
// `--color-ink:       #14110F` (aligned), and a single-space needle must still
// match. Needles below are written single-space; the haystack is normalised the
// same way, so formatting in index.css never breaks the token-presence checks.
const norm = (s: string) => s.replace(/\s+/g, ' ').toUpperCase();
const has = (haystack: string, needle: string) => norm(haystack).includes(norm(needle));

const BRAND_ORANGE = '#FF7300';

describe('OSU Momentum design tokens (PM032)', () => {
  it('primary ramp is OSU orange, indigo removed', () => {
    expect(has(css, '--color-primary-500: #FF7300')).toBe(true);
    expect(has(css, '--color-primary-600: #E06200')).toBe(true);
    expect(has(css, '--color-primary-800: #B24A00')).toBe(true);
    expect(has(css, '--color-primary-100: #FFEEDD')).toBe(true);
    expect(has(css, '--color-primary-50:  #FFF7EF')).toBe(true);
    // No indigo hue (264) survives on any primary line.
    const primaryLines = css
      .split('\n')
      .filter((l) => l.includes('--color-primary-'));
    expect(primaryLines.some((l) => l.includes('264'))).toBe(false);
  });

  it('warm-neutral and status tokens are present', () => {
    expect(has(css, '--color-ink: #14110F')).toBe(true);
    expect(has(css, '--color-app-bg: #FAF7F4')).toBe(true);
    expect(has(css, '--color-success-fg: #1F8A4C')).toBe(true);
    expect(has(css, '--color-pending-fg: #A07A1F')).toBe(true);
  });

  it('warning ramp is amber and distinct from brand orange', () => {
    expect(has(css, '--color-warning-700: #A07A1F')).toBe(true);
    // The below-threshold / warning colour must NOT be the brand orange.
    const warn700 = /--color-warning-700:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
    expect(warn700).toBeDefined();
    expect(warn700!.toUpperCase()).not.toBe(BRAND_ORANGE);
  });

  it('hours-below-threshold rule still drives off the warning token', () => {
    expect(has(css, 'color: var(--color-warning-700)')).toBe(true);
    expect(has(css, 'font-weight: 600')).toBe(true);
  });

  it('typography tokens, numeral utility, and font loading are wired', () => {
    expect(has(css, '--font-sans')).toBe(true);
    expect(has(css, 'Hanken Grotesk')).toBe(true);
    expect(has(css, '--font-display')).toBe(true);
    expect(has(css, 'Bricolage Grotesque')).toBe(true);
    expect(has(css, 'font-variant-numeric: tabular-nums')).toBe(true);
    expect(has(html, 'Bricolage+Grotesque')).toBe(true);
    expect(has(html, 'Hanken+Grotesk')).toBe(true);
    expect(has(html, 'fonts.googleapis.com')).toBe(true);
  });
});
