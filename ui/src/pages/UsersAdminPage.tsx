import { useState } from 'react';
import type { ReactElement } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';
import { useMe } from '../hooks/useMe.js';

// ---------------------------------------------------------------------------
// Types
//
// The paginated /api/users?page=N&pageSize=M response (API-029) is not the
// variant captured in the generated OpenAPI types (which document only the
// ?email= typeahead mode). The shape below mirrors the API-029 UserListResult
// service contract.
// ---------------------------------------------------------------------------

interface UserListItem {
  id: string;
  email: string;
  name: string;
  roles: string[];
  activeMentorGrantCount: number;
}

interface UserListResult {
  users: UserListItem[];
  totalCount: number;
}

const PAGE_SIZE = 20;

function useUserList(page: number) {
  return useQuery({
    queryKey: queryKeys.userList(page),
    queryFn: async () => {
      const res = await fetch(
        `/api/users?page=${page}&pageSize=${PAGE_SIZE}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw { status: res.status };
      return res.json() as Promise<UserListResult>;
    },
  });
}

// ---------------------------------------------------------------------------
// Role toggle mutation
// ---------------------------------------------------------------------------

function useToggleAdminRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      action,
    }: {
      userId: string;
      action: 'grant' | 'revoke';
    }) => {
      const res = await fetch(`/api/users/${userId}/roles`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin', action }),
      });
      if (!res.ok) {
        const status = res.status;
        const body = await res.json().catch(() => ({}));
        throw { status, body };
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.userList(0) });
      // Invalidate all pages by matching the prefix
      void queryClient.invalidateQueries({ queryKey: ['userList'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: string }): ReactElement {
  const isAdmin = role === 'admin';
  return (
    <span
      className={
        isAdmin
          ? 'rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800'
          : 'rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-muted'
      }
    >
      {role}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Role toggle button
// ---------------------------------------------------------------------------

interface RoleToggleButtonProps {
  user: UserListItem;
  currentUserId: string | undefined;
}

function RoleToggleButton({
  user,
  currentUserId,
}: RoleToggleButtonProps): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const mutation = useToggleAdminRole();

  const isCurrentUser = currentUserId !== undefined && user.id === currentUserId;
  const hasAdmin = user.roles.includes('admin');

  function handleClick() {
    setError(null);
    const action = hasAdmin ? 'revoke' : 'grant';
    const message = hasAdmin
      ? `Remove admin role from ${user.email}?`
      : `Promote ${user.email} to admin?`;

    if (!window.confirm(message)) return;

    mutation.mutate(
      { userId: user.id, action },
      {
        onError: (err: unknown) => {
          const e = err as { status?: number };
          if (e.status === 409) {
            setError('Cannot remove the last admin account.');
          } else {
            setError('Failed to update role. Please try again.');
          }
        },
      },
    );
  }

  if (isCurrentUser) {
    return (
      <div>
        <button
          type="button"
          disabled
          title="Cannot change your own role"
          className="rounded px-2 py-1 text-xs font-medium text-text-muted opacity-50 cursor-not-allowed"
        >
          {hasAdmin ? 'Remove admin' : 'Make admin'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={mutation.isPending}
        className={
          hasAdmin
            ? 'rounded px-2 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50 disabled:opacity-50'
            : 'rounded px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50'
        }
      >
        {hasAdmin ? 'Remove admin' : 'Make admin'}
      </button>
      {error !== null && (
        <p className="mt-1 text-xs text-danger-700">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function UsersAdminPage(): ReactElement {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useUserList(page);
  const { data: meData } = useMe();
  const currentUserId = meData?.user.id;

  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold text-text-default">Users</h1>

      {isLoading && <p className="text-sm text-text-muted">Loading users…</p>}

      {isError && (
        <p className="text-sm text-danger-700">Failed to load users.</p>
      )}

      {!isLoading && !isError && data && data.users.length === 0 && (
        <p className="text-sm text-text-muted">No users found.</p>
      )}

      {!isLoading && !isError && data && data.users.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-surface-muted text-left">
                  <th className="pb-2 pr-4 font-medium text-text-muted">Email</th>
                  <th className="pb-2 pr-4 font-medium text-text-muted">Name</th>
                  <th className="pb-2 pr-4 font-medium text-text-muted">Roles</th>
                  <th className="pb-2 pr-4 font-medium text-text-muted">
                    Active grants
                  </th>
                  <th className="pb-2 font-medium text-text-muted" />
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id} className="border-b border-surface-muted">
                    <td className="py-3 pr-4 text-text-default">{user.email}</td>
                    <td className="py-3 pr-4 text-text-default">{user.name}</td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.length > 0 ? (
                          user.roles.map((role) => (
                            <RoleBadge key={role} role={role} />
                          ))
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-text-default">
                      {user.activeMentorGrantCount}
                    </td>
                    <td className="py-3">
                      <RoleToggleButton
                        user={user}
                        currentUserId={currentUserId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-text-muted">
              Page {page} of {totalPages} · {totalCount} users
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!hasPrev}
                className="rounded border border-surface-muted px-3 py-1 text-xs font-medium text-text-default hover:bg-surface-muted disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext}
                className="rounded border border-surface-muted px-3 py-1 text-xs font-medium text-text-default hover:bg-surface-muted disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
