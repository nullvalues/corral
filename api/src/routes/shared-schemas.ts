import { z } from 'zod';

/**
 * Canonical API error envelope schema (API-053).
 *
 * Single source of truth for the `{ error: string }` response shape used across
 * every route's error responses. Any future change to the error envelope (e.g.
 * adding a `code` field) is made here once, not in ~20 route files.
 */
export const ErrorSchema = z.object({ error: z.string() });
