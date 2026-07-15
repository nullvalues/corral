import { NavLink } from 'react-router-dom';
import type { ReactElement } from 'react';

const tab = ({ isActive }: { isActive: boolean }) =>
  [
    'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
    isActive ? 'text-primary-500' : 'text-muted',
  ].join(' ');

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function HomeIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function GridIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function MentorIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}

function PersonIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function BottomTabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[640px] border-t border-hairline bg-card"
      aria-label="Primary"
    >
      <NavLink to="/home" className={tab}>
        <HomeIcon />
        Home
      </NavLink>
      <NavLink to="/experiences" className={tab}>
        <GridIcon />
        Categories
      </NavLink>
      <NavLink to="/mentor-status" className={tab}>
        <MentorIcon />
        Mentor
      </NavLink>
      <NavLink to="/profile" className={tab}>
        <PersonIcon />
        Profile
      </NavLink>
    </nav>
  );
}
