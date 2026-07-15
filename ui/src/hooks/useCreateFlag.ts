import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiFetch.js';
import type { paths } from '../api-types.js';

type CreateFlagResponse =
  paths['/api/experiences/{id}/flag']['post']['responses'][201]['content']['application/json'];

/**
 * Reviewer flags an experience for admin attention.
 * POST /api/experiences/:id/flag with { reason }. UI-101.
 *
 * No query invalidation: the reviewer has no flag list view — the admin
 * flag queue (/admin/flags) fetches independently.
 */
export function useCreateFlag() {
  return useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      apiFetch<CreateFlagResponse>(
        `/api/experiences/${encodeURIComponent(vars.id)}/flag`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: vars.reason }),
        },
      ),
  });
}
