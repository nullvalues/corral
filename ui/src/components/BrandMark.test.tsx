import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark.js';

describe('BrandMark', () => {
  afterEach(() => {
    cleanup();
  });

  function renderMark(props: Parameters<typeof BrandMark>[0] = {}) {
    const { container } = render(<BrandMark {...props} />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('expected svg to render');
    return svg;
  }

  it('renders the exact pen-circle dasharray/dashoffset geometry', () => {
    const svg = renderMark();
    const [penCircle] = svg.querySelectorAll('circle');
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 48');
    expect(penCircle.getAttribute('cx')).toBe('24');
    expect(penCircle.getAttribute('cy')).toBe('24');
    expect(penCircle.getAttribute('r')).toBe('16');
    expect(penCircle.getAttribute('fill')).toBe('none');
    expect(penCircle.getAttribute('stroke-width')).toBe('7');
    expect(penCircle.getAttribute('stroke-linecap')).toBe('round');
    expect(penCircle.getAttribute('stroke-dasharray')).toBe('76.5 24');
    expect(penCircle.getAttribute('stroke-dashoffset')).toBe('88.5');
  });

  it('renders the talent dot with r=5.5', () => {
    const svg = renderMark();
    const circles = svg.querySelectorAll('circle');
    const dot = circles[1];
    expect(dot.getAttribute('cx')).toBe('24');
    expect(dot.getAttribute('cy')).toBe('24');
    expect(dot.getAttribute('r')).toBe('5.5');
  });

  it('defaults to orange tone and 24px size', () => {
    const svg = renderMark();
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
    const [penCircle, dot] = svg.querySelectorAll('circle');
    expect(penCircle.getAttribute('stroke')).toBe('var(--color-primary-500)');
    expect(dot.getAttribute('fill')).toBe('var(--color-primary-500)');
  });

  it('maps ink tone to the ink token for both stroke and fill', () => {
    const svg = renderMark({ tone: 'ink' });
    const [penCircle, dot] = svg.querySelectorAll('circle');
    expect(penCircle.getAttribute('stroke')).toBe('var(--color-ink)');
    expect(dot.getAttribute('fill')).toBe('var(--color-ink)');
  });

  it('maps white tone to a hex literal fallback for both stroke and fill', () => {
    const svg = renderMark({ tone: 'white' });
    const [penCircle, dot] = svg.querySelectorAll('circle');
    // eslint-disable-next-line no-restricted-syntax -- asserting the documented white fallback literal
    expect(penCircle.getAttribute('stroke')).toBe('#FFFFFF');
    // eslint-disable-next-line no-restricted-syntax -- asserting the documented white fallback literal
    expect(dot.getAttribute('fill')).toBe('#FFFFFF');
  });

  it('applies size to width/height only, leaving viewBox constant', () => {
    const svg = renderMark({ size: 48 });
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 48');
  });

  it('is aria-hidden and unnamed when no title is given', () => {
    const svg = renderMark();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('title')).toBeNull();
  });

  it('renders a <title> and drops aria-hidden when a title prop is given', () => {
    const { container } = render(<BrandMark title="Corral Talent" />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('expected svg to render');
    expect(screen.getByTitle('Corral Talent')).toBeInTheDocument();
    expect(svg.querySelector('title')?.textContent).toBe('Corral Talent');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });
});
