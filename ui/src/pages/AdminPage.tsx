import { Link } from 'react-router-dom';

const ADMIN_LINKS = [
  { to: '/admin/categories', label: 'Categories', description: 'Manage experience categories.' },
  { to: '/admin/grants', label: 'Grants', description: 'Create and review mentor grants.' },
  { to: '/admin/users', label: 'Users', description: 'Browse users, roles, and active grants.' },
  { to: '/admin/settings', label: 'Readiness', description: 'Tune readiness-score formula weights.' },
  { to: '/admin/milestone-awards', label: 'Milestone awards', description: 'Audit milestone awards (user, milestone, earned date).' },
  { to: '/admin/flags', label: 'Flags', description: 'Review and resolve reviewer flags on experiences.' },
] as const;

export function AdminPage() {
  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold text-text-default">Admin</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="group rounded border border-surface-muted bg-surface-card p-4 hover:border-primary-500 transition-colors"
          >
            <p className="font-medium text-text-default group-hover:text-primary-500">{link.label}</p>
            <p className="mt-1 text-sm text-text-muted">{link.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
