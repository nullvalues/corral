import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AuthLayout } from '../layouts/AuthLayout.js';

const schema = z
  .object({
    newPassword: z.string().min(8),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

async function resetPasswordFn({
  token,
  newPassword,
}: {
  token: string;
  newPassword: string;
}): Promise<unknown> {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!res.ok) {
    throw { status: res.status };
  }
  return res.json().catch(() => ({}));
}

export function ResetPassword(): ReactElement {
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as unknown as Resolver<FormValues>,
  });

  const mutation = useMutation<unknown, unknown, { token: string; newPassword: string }>({
    mutationFn: resetPasswordFn,
    onSuccess: () => {
      void navigate('/sign-in', { state: { message: 'Password updated' } });
    },
  });

  const [showExpiredError, setShowExpiredError] = useState(false);

  useEffect(() => {
    if (mutation.isError) {
      setShowExpiredError(true);
    }
  }, [mutation.isError]);

  if (!token) {
    return (
      <AuthLayout>
        <h1 className="text-xl font-semibold text-text-default mb-4">Reset password</h1>
        <p role="alert" className="text-sm text-danger-600 mb-4">
          Invalid or missing reset link.
        </p>
        <Link to="/forgot-password" className="text-sm text-primary-600 hover:underline">
          Request a new reset link
        </Link>
      </AuthLayout>
    );
  }

  function onSubmit(values: FormValues): void {
    setShowExpiredError(false);
    mutation.mutate({ token: token!, newPassword: values.newPassword });
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-text-default mb-6">Set new password</h1>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="mb-4">
          <label htmlFor="newPassword" className="block text-sm font-medium text-text-default mb-1">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            {...register('newPassword')}
            className="w-full rounded border border-primary-300 bg-surface-base text-text-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
          {errors.newPassword && (
            <p className="text-sm text-danger-600 mt-1">{errors.newPassword.message}</p>
          )}
        </div>

        <div className="mb-6">
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-default mb-1">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...register('confirmPassword')}
            className="w-full rounded border border-primary-300 bg-surface-base text-text-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
          {errors.confirmPassword && (
            <p className="text-sm text-danger-600 mt-1">{errors.confirmPassword.message}</p>
          )}
        </div>

        {showExpiredError && (
          <p role="alert" className="text-sm text-danger-600 mb-4">
            This reset link has expired or is invalid.{' '}
            <Link to="/forgot-password" className="underline">
              Request a new one
            </Link>
            .
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-primary-500 text-text-inverted rounded px-4 py-2 text-sm font-medium hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthLayout>
  );
}
