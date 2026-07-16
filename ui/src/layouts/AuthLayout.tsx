import type { ReactElement, ReactNode } from 'react';
import { BrandMark } from '../components/BrandMark.js';

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Shared shell for the unauthenticated auth pages (sign-in, sign-up, forgot/reset
 * password, TOTP enrol/challenge) — brand lockup above a centered card. Extracted
 * so the lockup is defined once instead of duplicated across six pages.
 */
export function AuthLayout({ children }: AuthLayoutProps): ReactElement {
  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <BrandMark tone="orange" size={28} />
          <span className="font-display text-lg font-bold text-ink">Corral Talent</span>
        </div>
        <div className="bg-surface-card rounded-lg border border-primary-200 p-6">{children}</div>
      </div>
    </div>
  );
}
