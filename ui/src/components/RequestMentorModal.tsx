import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys.js';

interface RequestMentorModalProps {
  onClose: () => void;
}

interface RequestBody {
  mentorEmail: string;
}

interface SuccessResponse {
  id: string;
  status: 'pending';
}

async function postMentorRequest(body: RequestBody): Promise<SuccessResponse> {
  const res = await fetch('/api/mentor-grants/requests', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw { status: res.status };
  }

  return res.json() as Promise<SuccessResponse>;
}

export function RequestMentorModal({ onClose }: RequestMentorModalProps) {
  const [email, setEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: postMentorRequest,
    onSuccess: () => {
      setSuccessMessage('Request sent — awaiting admin approval');
      setErrorMessage(null);
      void qc.invalidateQueries({ queryKey: queryKeys.myApplicantGrants });
    },
    onError: (err: unknown) => {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        setErrorMessage('You already have a pending or active grant with this mentor');
      } else if (status === 404) {
        setErrorMessage('No user found with that email');
      } else {
        setErrorMessage('Something went wrong. Please try again.');
      }
      setSuccessMessage(null);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    mutation.mutate({ mentorEmail: email.trim() });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request a mentor"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-lg">
        <h2 className="mb-4 font-display text-lg font-bold text-ink">Request a mentor</h2>

        {successMessage ? (
          <div>
            <p className="mb-4 text-sm text-success-700" role="status">
              {successMessage}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-primary-500 px-4 py-2 text-sm text-text-inverted hover:bg-primary-600"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <label htmlFor="mentor-email" className="mb-1 block text-sm font-medium text-text-default">
              Mentor email address
            </label>
            <input
              id="mentor-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mentor@example.com"
              required
              className="mb-4 w-full rounded border border-surface-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />

            {errorMessage && (
              <p className="mb-4 text-sm text-danger-700" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={mutation.isPending}
                className="rounded border border-surface-muted px-4 py-2 text-sm text-text-default hover:bg-surface-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutation.isPending || !email.trim()}
                className="rounded-xl bg-primary-500 px-4 py-2 text-sm text-text-inverted hover:bg-primary-600 disabled:opacity-50"
              >
                {mutation.isPending ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
