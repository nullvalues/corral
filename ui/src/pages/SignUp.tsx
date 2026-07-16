import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import type { ReactElement, FormEvent } from 'react';
import { AuthLayout } from '../layouts/AuthLayout.js';

interface SignUpError {
  status: number;
  message: string;
}

async function signUpMutationFn(data: { email: string; password: string; name: string }): Promise<unknown> {
  const res = await fetch('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email: data.email, password: data.password, name: data.name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { status: res.status, message: (body as { message?: string }).message ?? 'Sign-up failed' };
  }
  return res.json();
}

export function SignUp(): ReactElement {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation<unknown, SignUpError, { email: string; password: string; name: string }>({
    mutationFn: signUpMutationFn,
    onSuccess: (_result, variables) => {
      void navigate('/enrol', { state: { password: variables.password } });
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    mutation.mutate({ email, password, name });
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-text-default mb-6">Create an account</h1>

      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-4">
          <label htmlFor="name" className="block text-sm font-medium text-text-default mb-1">
            Full name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            required
            autoComplete="name"
            className="w-full rounded border border-primary-300 bg-surface-base text-text-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
        </div>

        <div className="mb-4">
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

        <div className="mb-6">
          <label htmlFor="password" className="block text-sm font-medium text-text-default mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); }}
            required
            autoComplete="new-password"
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
          {mutation.isPending ? 'Creating account…' : 'Sign up'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-text-muted">
        Already have an account?{' '}
        <Link to="/sign-in" className="text-primary-500 hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
