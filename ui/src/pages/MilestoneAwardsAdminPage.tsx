import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';

interface MilestoneAwardRow {
  id: string;
  userId: string;
  email: string | null;
  milestoneKey: string;
  earnedAt: string;
}

function useMilestoneAwards() {
  return useQuery({
    queryKey: ['milestoneAwards'],
    queryFn: async () => {
      const res = await fetch('/api/admin/milestone-awards', {
        credentials: 'include',
      });
      if (!res.ok) throw { status: res.status };
      return res.json() as Promise<MilestoneAwardRow[]>;
    },
  });
}

export function MilestoneAwardsAdminPage(): ReactElement {
  const { data, isLoading, isError } = useMilestoneAwards();

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold text-text-default">
        Milestone awards
      </h1>

      {isLoading && (
        <p className="text-sm text-text-muted">Loading milestone awards…</p>
      )}

      {isError && (
        <p className="text-sm text-danger-700">Failed to load milestone awards.</p>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <p className="text-sm text-text-muted">No milestone awards found.</p>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-surface-muted text-left">
                <th className="pb-2 pr-4 font-medium text-text-muted">User</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">
                  Milestone
                </th>
                <th className="pb-2 font-medium text-text-muted">Earned</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-b border-surface-muted">
                  <td className="py-3 pr-4 text-text-default">
                    {row.email ?? row.userId}
                  </td>
                  <td className="py-3 pr-4 text-text-default">
                    {row.milestoneKey}
                  </td>
                  <td className="py-3 text-text-default">
                    {new Date(row.earnedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
