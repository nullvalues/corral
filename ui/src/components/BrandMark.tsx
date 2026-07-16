import type { ReactElement } from 'react';

export type BrandMarkTone = 'orange' | 'ink' | 'white';

export interface BrandMarkProps {
  /** Rendered size in px, applied to width/height only (viewBox stays constant). */
  size?: number;
  /** Tone maps to the shared color tokens; white has no token so falls back to a hex literal. */
  tone?: BrandMarkTone;
  /** Accessible name. When provided, renders a <title> child and omits aria-hidden. */
  title?: string;
}

const toneColor: Record<BrandMarkTone, string> = {
  orange: 'var(--color-primary-500)',
  ink: 'var(--color-ink)',
  // No --color-white token exists in ui/src/index.css; hex literal is the
  // documented fallback for this tone only (see design handoff README).
  // eslint-disable-next-line no-restricted-syntax
  white: '#FFFFFF',
};

/**
 * The Corral Talent brand mark — an open "pen" circle (the corral) with a
 * dot (the talent) inside. Pure presentational, no hooks. Geometry and
 * tones are final per docs/design_handoff_corral_talent_branding/README.md.
 */
export function BrandMark({ size = 24, tone = 'orange', title }: BrandMarkProps): ReactElement {
  const color = toneColor[tone];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      {...(title ? {} : { 'aria-hidden': true })}
    >
      {title ? <title>{title}</title> : null}
      <circle
        cx={24}
        cy={24}
        r={16}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray="76.5 24"
        strokeDashoffset="88.5"
      />
      <circle cx={24} cy={24} r={5.5} fill={color} />
    </svg>
  );
}
