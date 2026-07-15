import { NavLink, Outlet } from 'react-router-dom';
import type { ReactElement } from 'react';
import { MentorLevelBadge } from '../components/MentorLevelBadge.js';

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function DashboardIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function PoolIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  );
}

const navRow =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70';

const dashboardRow = ({ isActive }: { isActive: boolean }) =>
  [
    navRow,
    isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white',
  ].join(' ');

export function MentorWorkspaceLayout(): ReactElement {
  return (
    <div className="flex min-h-screen w-full bg-app-bg">
      <aside className="flex w-[226px] shrink-0 flex-col bg-ink px-3 py-5 max-[900px]:w-16 max-[900px]:px-2">
        {/* D9: typographic "O" brand placeholder — must be replaced with the
            official OSU lockup before real use. */}
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="font-display text-2xl font-bold leading-none text-white">O</span>
          <span className="font-display text-sm font-semibold text-white max-[900px]:hidden">
            Mentor
          </span>
        </div>

        <nav className="flex flex-col gap-1" aria-label="Mentor">
          <NavLink to="/mentor" end className={dashboardRow}>
            <DashboardIcon />
            <span className="max-[900px]:hidden">Dashboard</span>
          </NavLink>
          <NavLink to="/mentor/talent-pool" className={dashboardRow}>
            <PoolIcon />
            <span className="max-[900px]:hidden">Talent pool</span>
          </NavLink>
          {/* Hidden until implemented — re-add as NavLinks with their feature phases:
              "My applicants", "Verification queue" (mentor workspace build-out),
              "Reports" (future, ex-UI-071 scope). */}
        </nav>

        <div
          data-testid="mentor-level-card"
          className="mt-auto rounded-xl border border-white/10 bg-white/5 p-3 max-[900px]:hidden"
        >
          <MentorLevelBadge />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center border-b border-hairline bg-card px-6" />
        <main className="flex-1 bg-app-bg px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
