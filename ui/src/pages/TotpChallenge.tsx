import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ReactElement, FormEvent } from 'react';

interface TotpChallengeError {
  status: number;
  message: string;
}

export function TotpChallenge(): ReactElement {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const verifyMutation = useMutation<unknown, TotpChallengeError, string>({
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

  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-surface-card rounded-lg border border-primary-200 p-6">
        <h1 className="text-xl font-semibold text-text-default mb-2">Two-factor authentication</h1>
        <p className="text-sm text-text-muted mb-6">
          Enter the 6-digit code from your authenticator app.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-6">
            <label htmlFor="totp-code" className="block text-sm font-medium text-text-default mb-1">
              Authentication code
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
            {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  );
}
