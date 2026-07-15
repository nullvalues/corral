import { useState } from 'react';
import type { ReactElement } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUserSearch } from '../hooks/useUserSearch.js';
import type { UserSearchResult } from '../hooks/useUserSearch.js';
import { useMentorGrants } from '../hooks/useMentorGrants.js';
import { useCreateMentorGrant } from '../hooks/useCreateMentorGrant.js';
import { useRevokeMentorGrant } from '../hooks/useRevokeMentorGrant.js';
import { queryKeys } from '../lib/queryKeys.js';

// ---------------------------------------------------------------------------
// Pending grant type (API-032 extends the list response with display names)
// ---------------------------------------------------------------------------

interface PendingGrant {
  id: string;
  mentorUserId: string;
  applicantUserId: string;
  permissions: string[];
  grantedByUserId: string;
  grantedAt: string;
  status: string;
  applicantName: string;
  applicantEmail: string;
  mentorName: string;
  mentorEmail: string;
}

// ---------------------------------------------------------------------------
// Pending requests section
// ---------------------------------------------------------------------------

interface PendingRequestsSectionProps {
  grants: PendingGrant[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isActing: boolean;
}

function PendingRequestsSection({
  grants,
  onApprove,
  onReject,
  isActing,
}: PendingRequestsSectionProps): ReactElement {
  return (
    <section className="mb-8 rounded border border-surface-muted bg-surface-card p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-muted">
        Pending Requests
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-surface-muted text-left">
              <th className="pb-2 pr-4 font-medium text-text-muted">Applicant</th>
              <th className="pb-2 pr-4 font-medium text-text-muted">Requested Mentor</th>
              <th className="pb-2 font-medium text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr key={grant.id} className="border-b border-surface-muted">
                <td className="py-3 pr-4">
                  <p className="text-sm font-medium text-text-default">{grant.applicantName}</p>
                  <p className="text-xs text-text-muted">{grant.applicantEmail}</p>
                </td>
                <td className="py-3 pr-4">
                  <p className="text-sm font-medium text-text-default">{grant.mentorName}</p>
                  <p className="text-xs text-text-muted">{grant.mentorEmail}</p>
                </td>
                <td className="py-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onApprove(grant.id)}
                      disabled={isActing}
                      className="rounded bg-primary-500 px-3 py-1 text-xs font-medium text-text-inverted hover:bg-primary-600 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onReject(grant.id)}
                      disabled={isActing}
                      className="rounded border border-danger-700 px-3 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// User search section
// ---------------------------------------------------------------------------

interface UserSearchSectionProps {
  label: string;
  selected: UserSearchResult | null;
  onSelect: (user: UserSearchResult) => void;
  onClear: () => void;
}

function UserSearchSection({
  label,
  selected,
  onSelect,
  onClear,
}: UserSearchSectionProps): ReactElement {
  const [inputEmail, setInputEmail] = useState('');
  const [committedEmail, setCommittedEmail] = useState('');

  const { data: results, isFetching, isError } = useUserSearch(committedEmail);

  const handleSearch = (): void => {
    setCommittedEmail(inputEmail.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded border border-surface-muted bg-surface-card p-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-text-default">{selected.name}</p>
          <p className="text-xs text-text-muted">{selected.email}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-surface-muted px-3 py-1 text-xs text-text-default hover:bg-surface-muted"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-text-default">{label}</p>
      <div className="flex gap-2">
        <input
          type="email"
          value={inputEmail}
          onChange={(e) => setInputEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search by email"
          className="flex-1 rounded border border-surface-muted px-3 py-2 text-sm text-text-default"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={!inputEmail.trim()}
          className="rounded bg-primary-500 px-4 py-2 text-sm font-medium text-text-inverted hover:bg-primary-600 disabled:opacity-50"
        >
          Search
        </button>
      </div>

      {isFetching && (
        <p className="text-xs text-text-muted">Searching…</p>
      )}

      {isError && (
        <p className="text-xs text-danger-700">Search failed. Please try again.</p>
      )}

      {!isFetching && results && results.length === 0 && committedEmail && (
        <p className="text-xs text-text-muted">No users found for that email.</p>
      )}

      {!isFetching && results && results.length > 0 && (
        <ul className="rounded border border-surface-muted bg-surface-card">
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onSelect(user)}
                className="w-full px-3 py-2 text-left hover:bg-surface-muted"
              >
                <p className="text-sm font-medium text-text-default">{user.name}</p>
                <p className="text-xs text-text-muted">{user.email}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function GrantsAdminPage(): ReactElement {
  const [selectedMentor, setSelectedMentor] = useState<UserSearchResult | null>(null);
  const [selectedApplicant, setSelectedApplicant] = useState<UserSearchResult | null>(null);
  const [permRead, setPermRead] = useState(false);
  const [permWrite, setPermWrite] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const qc = useQueryClient();

  const { data: grants, isLoading: grantsLoading, isError: grantsError } = useMentorGrants();

  const { data: pendingGrants } = useQuery({
    queryKey: queryKeys.pendingGrants,
    queryFn: async () => {
      const res = await fetch('/api/mentor-grants?status=pending', { credentials: 'include' });
      if (!res.ok) throw { status: res.status };
      return res.json() as Promise<PendingGrant[]>;
    },
  });

  const reviewGrant = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'revoked' }) => {
      const res = await fetch(`/api/mentor-grants/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw { status: res.status };
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.pendingGrants });
      void qc.invalidateQueries({ queryKey: queryKeys.mentorGrants });
    },
  });

  const createGrant = useCreateMentorGrant();
  const revoke = useRevokeMentorGrant();

  const permissions: ('read' | 'write')[] = [
    ...(permRead ? (['read'] as const) : []),
    ...(permWrite ? (['write'] as const) : []),
  ];

  const canCreate =
    selectedMentor !== null &&
    selectedApplicant !== null &&
    permissions.length > 0;

  const handleCreate = async (): Promise<void> => {
    if (!selectedMentor || !selectedApplicant) return;
    setCreateError(null);
    try {
      await createGrant.mutateAsync({
        mentorUserId: selectedMentor.id,
        applicantUserId: selectedApplicant.id,
        permissions,
      });
      setSelectedMentor(null);
      setSelectedApplicant(null);
      setPermRead(false);
      setPermWrite(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create grant. Please try again.';
      setCreateError(message);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold text-text-default">Mentor Grants</h1>

      {/* Pending requests section — only rendered when there are pending grants */}
      {pendingGrants && pendingGrants.length > 0 && (
        <PendingRequestsSection
          grants={pendingGrants}
          onApprove={(id) => reviewGrant.mutate({ id, status: 'active' })}
          onReject={(id) => reviewGrant.mutate({ id, status: 'revoked' })}
          isActing={reviewGrant.isPending}
        />
      )}

      {/* Create grant form */}
      <section className="mb-8 rounded border border-surface-muted bg-surface-card p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Create Grant
        </h2>

        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1 text-sm font-medium text-text-muted">Mentor</p>
            <UserSearchSection
              label="Search mentor"
              selected={selectedMentor}
              onSelect={setSelectedMentor}
              onClear={() => setSelectedMentor(null)}
            />
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-text-muted">Applicant</p>
            <UserSearchSection
              label="Search applicant"
              selected={selectedApplicant}
              onSelect={setSelectedApplicant}
              onClear={() => setSelectedApplicant(null)}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-text-default">
              Permissions <span className="text-danger-700">*</span>
            </p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-text-default">
                <input
                  type="checkbox"
                  checked={permRead}
                  onChange={(e) => setPermRead(e.target.checked)}
                  className="rounded"
                />
                Read
              </label>
              <label className="flex items-center gap-2 text-sm text-text-default">
                <input
                  type="checkbox"
                  checked={permWrite}
                  onChange={(e) => setPermWrite(e.target.checked)}
                  className="rounded"
                />
                Write
              </label>
            </div>
          </div>

          {createError && (
            <p className="text-sm text-danger-700">{createError}</p>
          )}

          <div>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!canCreate || createGrant.isPending}
              className="rounded bg-primary-500 px-4 py-2 text-sm font-medium text-text-inverted hover:bg-primary-600 disabled:opacity-50"
            >
              {createGrant.isPending ? 'Creating…' : 'Create Grant'}
            </button>
          </div>
        </div>
      </section>

      {/* Grant list */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
          All Grants
        </h2>

        {grantsLoading && (
          <p className="text-sm text-text-muted">Loading grants…</p>
        )}

        {grantsError && (
          <p className="text-sm text-danger-700">Failed to load grants.</p>
        )}

        {!grantsLoading && !grantsError && grants && grants.length === 0 && (
          <p className="text-sm text-text-muted">No grants yet.</p>
        )}

        {!grantsLoading && !grantsError && grants && grants.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-surface-muted text-left">
                  <th className="pb-2 pr-4 font-medium text-text-muted">Mentor</th>
                  <th className="pb-2 pr-4 font-medium text-text-muted">Applicant</th>
                  <th className="pb-2 pr-4 font-medium text-text-muted">Permissions</th>
                  <th className="pb-2 pr-4 font-medium text-text-muted">Status</th>
                  <th className="pb-2 pr-4 font-medium text-text-muted">Granted At</th>
                  <th className="pb-2 font-medium text-text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} className="border-b border-surface-muted">
                    <td className="py-3 pr-4 font-mono text-xs text-text-default">
                      {grant.mentorUserId}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-text-default">
                      {grant.applicantUserId}
                    </td>
                    <td className="py-3 pr-4 text-text-default">
                      {grant.permissions.join(', ')}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={
                          grant.status === 'active'
                            ? 'rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800'
                            : 'rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-muted'
                        }
                      >
                        {grant.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-text-muted">
                      {new Date(grant.grantedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      {grant.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => revoke.mutate(grant.id)}
                          disabled={revoke.isPending}
                          className="rounded border border-danger-700 px-3 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50 disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-muted">
                          revoked
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
