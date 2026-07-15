import { useState } from 'react';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/apiFetch.js';
import { BackupCodesBlock } from '../components/BackupCodesBlock.js';

// ── Change-password schema ────────────────────────────────────────────────────

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

// ── Session types ─────────────────────────────────────────────────────────────

interface SessionEntry {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded border border-primary-300 bg-surface-base px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-focus-ring';

const sectionClass =
  'rounded-xl border border-surface-muted bg-card p-6';

// ── Sub-component: Change password ────────────────────────────────────────────

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<ChangePasswordValues & { confirmPassword: string }>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: async (body: { currentPassword: string; newPassword: string }) => {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setFieldErrors({});
      setServerError(null);
      setSuccess(true);
    },
    onError: () => {
      setServerError('Current password is incorrect or the request failed. Please try again.');
      setSuccess(false);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    const result = changePasswordSchema.safeParse({ currentPassword, newPassword, confirmPassword });
    if (!result.success) {
      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as string;
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs as Partial<ChangePasswordValues & { confirmPassword: string }>);
      return;
    }
    setFieldErrors({});
    setServerError(null);
    mutation.mutate({ currentPassword, newPassword });
  }

  return (
    <section aria-labelledby="change-password-heading" className={sectionClass}>
      <h2 id="change-password-heading" className="mb-4 text-lg font-semibold text-ink">
        Change password
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="cp-current" className="mb-1 block text-sm font-medium text-text-default">
            Current password
          </label>
          <input
            id="cp-current"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
            autoComplete="current-password"
          />
          {(fieldErrors as Record<string, string>).currentPassword && (
            <p className="mt-1 text-sm text-danger-700">{(fieldErrors as Record<string, string>).currentPassword}</p>
          )}
        </div>
        <div>
          <label htmlFor="cp-new" className="mb-1 block text-sm font-medium text-text-default">
            New password
          </label>
          <input
            id="cp-new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
          />
          {(fieldErrors as Record<string, string>).newPassword && (
            <p className="mt-1 text-sm text-danger-700">{(fieldErrors as Record<string, string>).newPassword}</p>
          )}
        </div>
        <div>
          <label htmlFor="cp-confirm" className="mb-1 block text-sm font-medium text-text-default">
            Confirm new password
          </label>
          <input
            id="cp-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
          />
          {(fieldErrors as Record<string, string>).confirmPassword && (
            <p className="mt-1 text-sm text-danger-700" data-testid="cp-confirm-error">
              {(fieldErrors as Record<string, string>).confirmPassword}
            </p>
          )}
        </div>
        {serverError && (
          <p className="text-sm text-danger-700" data-testid="cp-server-error">{serverError}</p>
        )}
        {success && (
          <p className="text-sm text-success-700" data-testid="cp-success">Password changed successfully.</p>
        )}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="self-start rounded-xl bg-primary-500 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}

// ── Sub-component: Active sessions ────────────────────────────────────────────

function ActiveSessionsSection() {
  const qc = useQueryClient();

  const { data: sessionsData, isLoading } = useQuery<{ sessions: SessionEntry[] }>({
    queryKey: ['activeSessions'],
    queryFn: () =>
      apiFetch<{ sessions: SessionEntry[] }>('/api/auth/list-sessions'),
  });

  const { data: currentSession } = useQuery<{ session?: { token?: string } }>({
    queryKey: ['currentSession'],
    queryFn: () =>
      apiFetch<{ session?: { token?: string } }>('/api/auth/get-session'),
  });

  const currentToken = currentSession?.session?.token;

  const revokeMutation = useMutation({
    mutationFn: (token: string) =>
      apiFetch('/api/auth/revoke-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activeSessions'] });
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/auth/revoke-other-sessions', {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activeSessions'] });
    },
  });

  const sessions = sessionsData?.sessions ?? [];

  return (
    <section aria-labelledby="sessions-heading" className={sectionClass}>
      <div className="mb-4 flex items-center justify-between">
        <h2 id="sessions-heading" className="text-lg font-semibold text-ink">
          Active sessions
        </h2>
        {sessions.length > 1 && (
          <button
            type="button"
            onClick={() => revokeAllMutation.mutate()}
            disabled={revokeAllMutation.isPending}
            className="text-sm text-danger-700 hover:underline disabled:opacity-50"
            data-testid="revoke-all-btn"
          >
            Revoke all other sessions
          </button>
        )}
      </div>
      {isLoading && <p className="text-sm text-text-muted">Loading sessions…</p>}
      {!isLoading && sessions.length === 0 && (
        <p className="text-sm text-text-muted">No active sessions found.</p>
      )}
      {!isLoading && sessions.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-muted">
              <th className="pb-2 text-left font-medium text-text-muted">Device / User agent</th>
              <th className="pb-2 text-left font-medium text-text-muted">Started</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const isCurrent = s.token === currentToken;
              return (
                <tr key={s.id} className="border-b border-surface-muted last:border-0">
                  <td className="py-3 pr-4 text-text-default">
                    {s.userAgent ?? 'Unknown device'}
                    {isCurrent && (
                      <span className="ml-2 rounded bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-700">
                        This device
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-text-muted">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 text-right">
                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(s.token)}
                        disabled={revokeMutation.isPending}
                        className="text-sm text-danger-700 hover:underline disabled:opacity-50"
                        data-testid={`revoke-session-${s.id}`}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Sub-component: Backup codes ──────────────────────────────────────────────
//
// Story note: BA 1.6.11 exposes POST /api/auth/two-factor/generate-backup-codes
// (requires password). The current backup code COUNT is not readable via a
// public BA endpoint (viewBackupCodes is an internal helper with no HTTP path),
// so the count is displayed as "Unknown". Regeneration uses the BA endpoint and
// requires the user's password via a small inline dialog.

function BackupCodesSection() {
  const [showRegenForm, setShowRegenForm] = useState(false);
  const [password, setPassword] = useState('');
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const regenMutation = useMutation({
    mutationFn: async (pwd: string) => {
      try {
        const data = await apiFetch<{ status: boolean; backupCodes: string[] }>(
          '/api/auth/two-factor/generate-backup-codes',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd }),
          },
        );
        return (data as { status: boolean; backupCodes: string[] }).backupCodes;
      } catch (err) {
        const apiErr = err as { body?: { message?: string }; message?: string };
        throw new Error(apiErr?.body?.message ?? apiErr?.message ?? 'Failed to regenerate backup codes');
      }
    },
    onSuccess: (codes) => {
      setNewCodes(codes);
      setShowRegenForm(false);
      setPassword('');
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  function handleRegenSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    regenMutation.mutate(password);
  }

  return (
    <section aria-labelledby="backup-codes-heading" className={sectionClass}>
      <h2 id="backup-codes-heading" className="mb-2 text-lg font-semibold text-ink">
        Backup codes
      </h2>
      <p className="mb-4 text-sm text-text-muted">
        Backup codes let you sign in if you lose access to your authenticator app.
        Current backup codes remaining:{' '}
        <span data-testid="backup-codes-count" className="font-medium text-text-default">
          Unknown
        </span>
      </p>

      {newCodes !== null && (
        <div className="mb-4">
          <BackupCodesBlock codes={newCodes} />
        </div>
      )}

      {!showRegenForm && (
        <button
          type="button"
          data-testid="regen-backup-codes-btn"
          onClick={() => { setShowRegenForm(true); setNewCodes(null); }}
          className="rounded-xl bg-primary-500 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600"
        >
          Regenerate backup codes
        </button>
      )}

      {showRegenForm && (
        <form onSubmit={handleRegenSubmit} className="flex flex-col gap-3" data-testid="regen-form">
          <p className="text-sm text-text-default">
            Enter your password to confirm code regeneration. Old codes will be invalidated.
          </p>
          <div>
            <label htmlFor="regen-password" className="mb-1 block text-sm font-medium text-text-default">
              Password
            </label>
            <input
              id="regen-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="current-password"
              data-testid="regen-password-input"
            />
          </div>
          {error && (
            <p className="text-sm text-danger-700" data-testid="regen-error">{error}</p>
          )}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={regenMutation.isPending || !password}
              className="rounded-xl bg-primary-500 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
              data-testid="regen-submit-btn"
            >
              {regenMutation.isPending ? 'Regenerating…' : 'Generate new codes'}
            </button>
            <button
              type="button"
              onClick={() => { setShowRegenForm(false); setPassword(''); setError(null); }}
              className="rounded-xl border border-surface-muted px-5 py-2 text-sm text-text-default hover:bg-surface-base"
              data-testid="regen-cancel-btn"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ── Sub-component: Delete account ─────────────────────────────────────────────

function DeleteAccountSection() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'idle' | 'confirm'>('idle');
  const [password, setPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      await apiFetch('/api/auth/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      await apiFetch('/api/auth/sign-out', { method: 'POST' });
      navigate('/sign-in', { replace: true });
    } catch {
      setError('Could not delete account. Please try again.');
      setIsDeleting(false);
    }
  }

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="rounded-xl border border-danger-300 bg-card p-6"
    >
      <h2 id="delete-account-heading" className="mb-2 text-lg font-semibold text-danger-700">
        Delete account
      </h2>
      <p className="mb-4 text-sm text-text-muted">
        Permanently delete your account and all associated data. This action cannot be undone.
      </p>
      {step === 'idle' && (
        <button
          type="button"
          onClick={() => setStep('confirm')}
          className="rounded-xl border border-danger-300 px-5 py-2 text-sm font-semibold text-danger-700 hover:bg-danger-50"
          data-testid="delete-account-btn"
        >
          Delete my account
        </button>
      )}
      {step === 'confirm' && (
        <div className="flex flex-col gap-3" data-testid="delete-confirm-panel">
          <p className="text-sm font-medium text-danger-700">
            Are you sure? This will permanently delete your account.
          </p>
          <div>
            <label htmlFor="delete-password" className="mb-1 block text-sm font-medium text-text-default">
              Enter your password to confirm
            </label>
            <input
              id="delete-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="current-password"
              data-testid="delete-password-input"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting || !password}
              className="rounded-xl bg-danger-700 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              data-testid="delete-confirm-yes"
            >
              {isDeleting ? 'Deleting…' : 'Yes, delete my account'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('idle'); setPassword(''); setError(null); }}
              className="rounded-xl border border-surface-muted px-5 py-2 text-sm text-text-default hover:bg-surface-base"
              data-testid="delete-confirm-cancel"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className="text-sm text-danger-700" data-testid="delete-error">{error}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AccountSettingsPage() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mb-6 font-display text-2xl font-bold text-ink">Account settings</h1>
      <div className="flex flex-col gap-6">
        <ChangePasswordSection />
        <ActiveSessionsSection />
        <BackupCodesSection />
        <DeleteAccountSection />
      </div>
    </div>
  );
}
