import type { ReactElement } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type FlagRow =
  paths['/api/admin/flags']['get']['responses'][200]['content']['application/json'][number];
type ResolveFlagResponse =
  paths['/api/admin/flags/{id}']['patch']['responses'][200]['content']['application/json'];

function useAdminFlags(showAll: boolean) {
  return useQuery({
    queryKey: ['adminFlags', showAll ? 'all' : 'open'],
    queryFn: () =>
      apiFetch<FlagRow[]>(
        showAll ? '/api/admin/flags' : '/api/admin/flags?status=open',
      ),
  });
}

function useResolveFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ResolveFlagResponse>(
        `/api/admin/flags/${encodeURIComponent(id)}`,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adminFlags'] });
    },
  });
}

/**
 * /admin/flags — admin flag review view (UI-101).
 * Lists flag_report rows (default: open only, toggle for all statuses) with
 * a "Mark resolved" action calling PATCH /api/admin/flags/:id (API-059).
 */
export function FlagsAdminPage(): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError } = useAdminFlags(showAll);
  const resolve = useResolveFlag();

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-default">Flags</h1>
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            data-testid="show-all-toggle"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Show all statuses
        </label>
      </div>

      {isLoading && <p className="text-sm text-text-muted">Loading flags…</p>}

      {isError && (
        <p className="text-sm text-danger-700">Failed to load flags.</p>
      )}

      {resolve.isError && (
        <p data-testid="resolve-error" className="mb-4 text-sm text-danger-700">
          Failed to resolve flag. Please try again.
        </p>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <p className="text-sm text-text-muted">
          {showAll ? 'No flags found.' : 'No open flags.'}
        </p>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-surface-muted text-left">
                <th className="pb-2 pr-4 font-medium text-text-muted">Experience</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Applicant</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Flagged by</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Reason</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Date</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Status</th>
                <th className="pb-2 font-medium text-text-muted">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`flag-row-${row.id}`}
                  className="border-b border-surface-muted"
                >
                  <td className="py-3 pr-4 text-text-default">
                    {row.organization ?? '—'}
                    {row.position ? (
                      <span className="text-text-muted"> · {row.position}</span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 text-text-default">
                    {row.ownerUserId ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-text-default">
                    {row.reviewerName ?? row.reviewerEmail ?? row.reviewerUserId}
                  </td>
                  <td className="max-w-xs py-3 pr-4 text-text-default break-words">
                    {row.reason}
                  </td>
                  <td className="py-3 pr-4 text-text-default">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 pr-4 text-text-default">{row.status}</td>
                  <td className="py-3">
                    {row.status === 'open' && (
                      <button
                        type="button"
                        data-testid={`resolve-btn-${row.id}`}
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate(row.id)}
                        className="rounded bg-primary-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
                      >
                        Mark resolved
                      </button>
                    )}
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
