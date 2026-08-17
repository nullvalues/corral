import { Navigate, Outlet } from 'react-router-dom';
import { BottomTabBar } from '../components/BottomTabBar.js';
import { useUserRoles } from '../hooks/useUserRoles.js';

export function ApplicantLayout() {
  const { isAdmin, isApplicant, isLoading } = useUserRoles();
  if (isLoading) return <div>Loading…</div>;
  // Non-applicants belong in a workspace of their own: admins in /admin,
  // everyone else (mentor-only accounts hold no system role) in /mentor.
  if (!isApplicant) return <Navigate to={isAdmin ? '/admin' : '/mentor'} replace />;

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="mx-auto max-w-[640px] pb-24">
        <Outlet />
      </div>
      <BottomTabBar />
    </div>
  );
}
