import { Link, Navigate, Outlet } from 'react-router-dom';
import { useMe } from '../hooks/useMe.js';

export function AdminLayout() {
  const { data, isLoading } = useMe();
  if (isLoading) return <div>Loading…</div>;
  if (!data?.roles.includes('admin')) return <Navigate to="/experiences" replace />;
  return (
    <div className="min-h-screen bg-surface-default">
      <nav className="flex gap-4 border-b border-surface-muted px-6 py-3 text-sm">
        <Link className="font-medium text-primary-500 hover:text-primary-600" to="/admin/categories">Categories</Link>
        <Link className="font-medium text-primary-500 hover:text-primary-600" to="/admin/grants">Grants</Link>
        <Link className="font-medium text-primary-500 hover:text-primary-600" to="/admin/users">Users</Link>
        <Link className="font-medium text-primary-500 hover:text-primary-600" to="/admin/settings">Readiness</Link>
        <Link className="font-medium text-primary-500 hover:text-primary-600" to="/admin/milestone-awards">Milestone awards</Link>
      </nav>
      <Outlet />
    </div>
  );
}
