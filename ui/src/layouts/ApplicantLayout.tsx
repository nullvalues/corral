import { Navigate, Outlet } from 'react-router-dom';
import { BottomTabBar } from '../components/BottomTabBar.js';
import { useUserRoles } from '../hooks/useUserRoles.js';

export function ApplicantLayout() {
  const { isApplicant, isLoading } = useUserRoles();
  if (isLoading) return <div>Loading…</div>;
  if (!isApplicant) return <Navigate to="/admin" replace />;

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="mx-auto max-w-[640px] pb-24">
        <Outlet />
      </div>
      <BottomTabBar />
    </div>
  );
}
