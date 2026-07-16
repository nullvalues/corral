import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import type { ReactElement, FormEvent } from 'react';
import { BackupCodesBlock } from '../components/BackupCodesBlock.js';
import { AuthLayout } from '../layouts/AuthLayout.js';

interface TotpEnrolError {
  status: number;
  message: string;
}

interface EnableTotpResult {
  totpURI: string;
  backupCodes: string[];
}

// /enrol is the enrolment-only screen reached from sign-up.
// It always calls two-factor/enable to obtain the TOTP secret and QR code.
// Returning-user TOTP challenge (mid-sign-in) lives at /two-factor (TotpChallenge, UI-090).
// Do not merge these flows.

export function TotpEnrol(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const routePassword = (location.state as { password?: string } | null)?.password ?? '';
  const [code, setCode] = useState('');

  // `enable` unconditionally generates a brand-new TOTP secret and deletes the
  // previous unverified one on every call — calling it twice silently invalidates
  // whatever secret the user already scanned. This used to fire imperatively from
  // useEffect+useMutation, which React StrictMode's dev-mode double-invoke breaks:
  // the network call gets deduped, but useMutation's internal state subscription
  // doesn't survive the simulated unmount/remount, so the UI got stuck "pending"
  // forever. useQuery is what TanStack Query designs for exactly this "run once on
  // mount" shape — its fetch is deduplicated and its observer is StrictMode-safe.
  const enableQuery = useQuery<EnableTotpResult, TotpEnrolError>({
    queryKey: ['two-factor-enable'],
    queryFn: async () => {
      const res = await fetch('/api/auth/two-factor/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: routePassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw { status: res.status, message: (body as { message?: string }).message ?? 'Failed to enable TOTP' };
      }
      return res.json() as Promise<EnableTotpResult>;
    },
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const verifyMutation = useMutation<unknown, TotpEnrolError, string>({
    mutationFn: async (totpCode: string) => {
      const res = await fetch('/api/auth/two-factor/verify-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: totpCode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw { status: res.status, message: (body as { message?: string }).message ?? 'Invalid code' };
      }
      return res.json();
    },
    onSuccess: () => {
      void navigate('/');
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    verifyMutation.mutate(code);
  }

  const backupCodes = enableQuery.data?.backupCodes ?? [];
  const hasBackupCodes = backupCodes.length > 0;

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-text-default mb-6">Set up two-factor authentication</h1>

      {enableQuery.isPending && (
        <p className="text-sm text-text-default mb-4">Setting up TOTP…</p>
      )}

      {enableQuery.isError && (
        <p role="alert" className="text-sm text-text-default mb-4">
          {enableQuery.error.message}
        </p>
      )}

      {enableQuery.data?.totpURI && (
        <div className="mb-6 flex flex-col items-center gap-4">
          <p className="text-sm text-text-default text-center">
            Scan this QR code with your authenticator app.
          </p>
          <div data-testid="qr-code">
            <QRCodeSVG value={enableQuery.data.totpURI} size={200} />
          </div>
          <div className="w-full mt-2">
            <p className="text-xs text-text-muted text-center mb-1">
              Can&apos;t scan? Enter this code manually in your authenticator app.
            </p>
            <p
              data-testid="totp-secret"
              className="font-mono text-sm text-text-default bg-surface-base border border-primary-200 rounded px-3 py-2 text-center select-all break-all"
            >
              {new URL(enableQuery.data.totpURI).searchParams.get('secret')}
            </p>
          </div>
        </div>
      )}

      {hasBackupCodes && (
        <div className="mb-6">
          <BackupCodesBlock codes={backupCodes} />
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-6">
          <label htmlFor="totp-code" className="block text-sm font-medium text-text-default mb-1">
            6-digit code
          </label>
          <input
            id="totp-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => { setCode(e.target.value); }}
            required
            autoComplete="one-time-code"
            className="w-full rounded border border-primary-300 bg-surface-base text-text-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
        </div>

        {verifyMutation.isError && (
          <p role="alert" className="text-sm text-text-default mb-4">
            {verifyMutation.error.message}
          </p>
        )}

        <button
          type="submit"
          disabled={verifyMutation.isPending}
          className="w-full bg-primary-500 text-text-inverted rounded px-4 py-2 text-sm font-medium hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
        >
          {verifyMutation.isPending ? 'Verifying…' : 'Verify code'}
        </button>
      </form>
    </AuthLayout>
  );
}
