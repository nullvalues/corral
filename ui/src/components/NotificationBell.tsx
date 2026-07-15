/**
 * NotificationBell — client-side notification badge + dropdown.
 *
 * Detection: experiences whose `verificationStatus` became `verified` and whose
 * `verifiedAt` (or `updatedAt` as fallback) is later than the stored
 * per-user ack timestamp.
 *
 * State: `localStorage` under `asp:notifications:ack:<userId>` (ISO timestamp).
 * Read-state is per-user so switching accounts cannot leak ack state.
 *
 * Phase-1 approximation: detection only while the app is open; no server push.
 */

import { useEffect, useRef, useState } from 'react';
import { useCurrentUserId } from '../hooks/useCurrentUserId.js';
import { useExperiences } from '../hooks/useExperiences.js';

type Experience = {
  id: string;
  organization: string;
  position: string;
  verificationStatus: 'unverified' | 'verified';
  verifiedAt: string | null;
  updatedAt: string;
};

function ackKey(userId: string) {
  return `asp:notifications:ack:${userId}`;
}

function getStoredAck(userId: string): string | null {
  try {
    return localStorage.getItem(ackKey(userId));
  } catch {
    return null;
  }
}

function setStoredAck(userId: string, isoTimestamp: string) {
  try {
    localStorage.setItem(ackKey(userId), isoTimestamp);
  } catch {
    // storage unavailable; silently ignore
  }
}

/** Returns the effective timestamp for a verified experience (verifiedAt ?? updatedAt). */
function effectiveTimestamp(exp: Experience): string {
  return exp.verifiedAt ?? exp.updatedAt;
}

/** Returns experiences that are verified and newer than the stored ack timestamp. */
function computeNotifications(
  experiences: Experience[],
  ackTimestamp: string | null,
): Experience[] {
  return experiences
    .filter((exp) => {
      if (exp.verificationStatus !== 'verified') return false;
      if (!ackTimestamp) return true;
      return effectiveTimestamp(exp) > ackTimestamp;
    })
    .sort((a, b) =>
      effectiveTimestamp(b).localeCompare(effectiveTimestamp(a)),
    )
    .slice(0, 10);
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const userId = useCurrentUserId();
  const { data: experiences } = useExperiences(userId);
  const [open, setOpen] = useState(false);
  const [ackTimestamp, setAckTimestamp] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load stored ack on userId change
  useEffect(() => {
    if (!userId) return;
    setAckTimestamp(getStoredAck(userId));
  }, [userId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!userId || !experiences) return null;

  const notifications = computeNotifications(
    experiences as Experience[],
    ackTimestamp,
  );
  const count = notifications.length;

  function handleMarkAllRead() {
    const now = new Date().toISOString();
    setStoredAck(userId!, now);
    setAckTimestamp(now);
    setOpen(false);
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        aria-label={
          count > 0 ? `Notifications — ${count} unread` : 'Notifications'
        }
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded-full text-text-default focus:outline-none focus:ring-2 focus:ring-focus-ring"
        data-testid="notification-bell"
      >
        {/* Bell SVG — pure Tailwind, no inline styles */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Badge */}
        {count > 0 && (
          <span
            className="absolute top-0 right-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary-500 text-text-inverted text-[10px] font-semibold leading-none"
            data-testid="notification-badge"
            aria-hidden="true"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 rounded-xl border border-hairline bg-card shadow-lg z-50"
          data-testid="notification-dropdown"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
            <span className="text-sm font-semibold text-ink">
              Notifications
            </span>
            {count > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-primary-500 hover:text-primary-600 font-medium"
                data-testid="mark-all-read"
              >
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-80 overflow-y-auto divide-y divide-hairline">
            {notifications.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted text-center">
                No new notifications.
              </li>
            ) : (
              notifications.map((exp) => (
                <li
                  key={exp.id}
                  className="px-4 py-3"
                  data-testid="notification-item"
                >
                  <p className="text-sm font-medium text-ink truncate">
                    {exp.organization}
                  </p>
                  <p className="text-xs text-muted truncate">{exp.position}</p>
                  <p className="text-xs text-success-700 mt-0.5">
                    Verified ·{' '}
                    {formatRelativeTime(effectiveTimestamp(exp))}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
