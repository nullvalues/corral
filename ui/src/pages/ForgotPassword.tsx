import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ReactElement, FormEvent } from 'react';
import { AuthLayout } from '../layouts/AuthLayout.js';

async function requestPasswordResetFn({ email }: { email: string }): Promise<Response> {
  const res = await fetch('/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirectTo: window.location.origin + '/reset-password' }),
  });
  // Do not throw on non-200 — anti-enumeration: same message regardless of outcome
  return res;
}

export function ForgotPassword(): ReactElement {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation<Response, unknown, { email: string }>({
    mutationFn: requestPasswordResetFn,
    onSettled: () => {
      setSubmitted(true);
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    mutation.mutate({ email });
  }

  if (submitted) {
    return (
      <AuthLayout>
        <h1 className="text-xl font-semibold text-text-default mb-4">Check your email</h1>
        <p className="text-sm text-text-default mb-6">
          If that address is registered, a reset link is on its way.
        </p>
        <Link
          to="/sign-in"
          className="text-sm text-primary-600 hover:underline"
        >
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-text-default mb-2">Forgot password?</h1>
      <p className="text-sm text-text-default mb-6">
        Enter your email address and we&apos;ll send you a reset link.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-6">
          <label htmlFor="email" className="block text-sm font-medium text-text-default mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); }}
            required
            autoComplete="email"
            className="w-full rounded border border-primary-300 bg-surface-base text-text-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-primary-500 text-text-inverted rounded px-4 py-2 text-sm font-medium hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
        >
          {mutation.isPending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p className="mt-4 text-sm text-text-default">
        <Link to="/sign-in" className="text-primary-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
