import { useEffect } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { useMe } from '../hooks/useMe.js';
import { ApplicantPicker } from '../components/ApplicantPicker.js';
import { NotificationBell } from '../components/NotificationBell.js';

interface Session {
  user: {
    twoFactorEnabled: boolean;
  };
}

export function ProtectedLayout() {
  const navigate = useNavigate();
  const { data: me, isLoading: meLoading } = useMe();

  const { data: session, isLoading, error } = useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => {
      const res = await fetch('/api/auth/get-session', { credentials: 'include' });
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if ((body as { code?: string }).code === 'MFA_REQUIRED') {
          throw { status: 403, code: 'MFA_REQUIRED' };
        }
      }
      if (!res.ok) throw { status: res.status };
      return res.json() as Promise<Session | null>;
    },
  });

  // Handle session state: null (no session) or unenrolled
  useEffect(() => {
    if (isLoading) return;
    if (session === null) {
      navigate('/sign-in', { replace: true });
      return;
    }
    if (session?.user.twoFactorEnabled === false) {
      navigate('/enrol', { replace: true });
    }
  }, [session, isLoading, navigate]);

  // Handle 403 MFA_REQUIRED error
  useEffect(() => {
    if ((error as { code?: string } | null)?.code === 'MFA_REQUIRED') {
      navigate('/enrol', { replace: true });
    }
  }, [error, navigate]);

  // Listen for re-auth event (dispatched by QueryClient on 401)
  useEffect(() => {
    const handler = () => navigate('/sign-in', { replace: true });
    window.addEventListener('re-auth', handler);
    return () => window.removeEventListener('re-auth', handler);
  }, [navigate]);

  if (isLoading) {
    return <div />;
  }

  // Only render protected content when session is valid and enrolled
  if (!session || session.user.twoFactorEnabled === false) {
    return <div />;
  }

  const isAdmin = me?.roles?.includes('admin') ?? false;
  const hasMentorGrants = me?.hasMentorGrants ?? false;

  async function handleSignOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    navigate('/sign-in', { replace: true });
  }

  return (
    <div>
      {!meLoading && (
        <header className="flex items-center justify-between border-b border-surface-muted px-4 py-2">
          <nav className="flex items-center gap-4">
            <Link to="/" className="text-sm text-text-default">
              asp
            </Link>
            {isAdmin ? (
              <>
                <Link to="/admin" className="text-sm text-text-default">
                  Admin
                </Link>
                <Link to="/experiences" className="text-sm text-text-default">
                  Experiences
                </Link>
              </>
            ) : (
              <Link to="/experiences" className="text-sm text-text-default">
                Experiences
              </Link>
            )}
            {hasMentorGrants && (
              <Link to="/mentor" className="text-sm text-text-default">
                Mentor workspace
              </Link>
            )}
            <Link to="/settings" className="text-sm text-text-default">
              Account settings
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <button
              type="button"
              onClick={handleSignOut}
              className="text-sm text-text-default"
            >
              Sign out
            </button>
          </div>
        </header>
      )}
      <div className="flex justify-end px-4 py-2">
        <ApplicantPicker />
      </div>
      <Outlet />
    </div>
  );
}
