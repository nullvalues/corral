import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import type { ReactElement, FormEvent } from 'react';
import { AuthLayout } from '../layouts/AuthLayout.js';

interface SignInError {
  status: number;
  message: string;
}

async function signInMutationFn(data: { email: string; password: string }): Promise<unknown> {
  const res = await fetch('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email: data.email, password: data.password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { status: res.status, message: (body as { message?: string }).message ?? 'Sign-in failed' };
  }
  return res.json();
}

export function SignIn(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | undefined>(
    (location.state as { message?: string } | null)?.message,
  );

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => { setSuccessMessage(undefined); }, 4000);
    return () => { clearTimeout(timer); };
  }, [successMessage]);

  const mutation = useMutation<unknown, SignInError, { email: string; password: string }>({
    mutationFn: signInMutationFn,
    onSuccess: (data) => {
      const body = data as { twoFactorRedirect?: boolean };
      void navigate(body.twoFactorRedirect ? '/two-factor' : '/');
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    mutation.mutate({ email, password });
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-text-default mb-6">Sign in</h1>

      {successMessage && (
        <p role="status" className="text-sm text-text-default bg-primary-50 border border-primary-200 rounded px-3 py-2 mb-4">
          {successMessage}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium text-text-default mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSuccessMessage(undefined); }}
            required
            autoComplete="email"
            className="w-full rounded border border-primary-300 bg-surface-base text-text-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
        </div>

        <div className="mb-6">
          <label htmlFor="password" className="block text-sm font-medium text-text-default mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setSuccessMessage(undefined); }}
            required
            autoComplete="current-password"
            className="w-full rounded border border-primary-300 bg-surface-base text-text-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
        </div>

        {mutation.isError && (
          <p role="alert" className="text-sm text-text-default mb-4">
            {mutation.error.message}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-primary-500 text-text-inverted rounded px-4 py-2 text-sm font-medium hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
        >
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-sm text-text-default">
        <Link to="/forgot-password" className="text-primary-600 hover:underline">
          Forgot password?
        </Link>
      </p>

      <p className="mt-3 text-center text-sm text-text-muted">
        Don't have an account?{' '}
        <Link to="/sign-up" className="text-primary-500 hover:underline font-medium">
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
}
