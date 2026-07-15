/**
 * AiClient — single-seam interface to the external AI provider.
 *
 * This module is the ONLY place in `@asp/api` permitted to import the
 * Anthropic SDK (`@anthropic-ai/sdk`). Route handlers, services, and agents
 * must depend on the `AiClient` interface and receive a concrete
 * implementation via `fastify.aiClient` (see `src/plugins/ai.ts`). The
 * ESLint `no-restricted-imports` rule in `api/eslint.config.js` enforces
 * this containment.
 *
 * Phase 1 ships only the stub: `complete()` throws `NotImplementedError`.
 * Later phases replace `buildAiClient()` with a real implementation; tests
 * and the in-memory composition root inject fakes via
 * `buildApp({ aiClient })`.
 *
 * The `AiCompleteParams` / `AiResponse` shapes are deliberately minimal in
 * Phase 1 — the surface will be expanded when the first real AI feature
 * lands. Keeping them small now avoids speculative fields that drift before
 * a real call site exists.
 */

import { NotImplementedError } from './errors.js';

/**
 * Configuration handle passed to `buildAiClient()` once real implementations
 * land. Kept opaque in Phase 1 — the stub ignores it.
 */
export type AiClientConfig = Record<string, never>;

/**
 * Parameters for a single completion call. Minimal in Phase 1; expand when
 * the first AI feature lands.
 */
export interface AiCompleteParams {
  /** Prompt or message body forwarded to the model. */
  readonly prompt?: string;
}

/**
 * Response shape for a completion call. Minimal in Phase 1; expand when the
 * first AI feature lands.
 */
export interface AiResponse {
  /** Completion text returned by the model. */
  readonly text?: string;
}

export interface AiClient {
  /** Run a single completion against the provider. */
  complete(params: AiCompleteParams): Promise<AiResponse>;
}

/**
 * Default factory. In Phase 1 it returns a stub whose `complete()` throws
 * `NotImplementedError` — route handlers that depend on AI will fail loudly
 * rather than silently no-op. Later phases swap this body for a real
 * provider-backed client; the call sites do not change.
 *
 * The `_cfg` parameter is accepted for forward compatibility so call sites
 * can be written today without a follow-up rename.
 */
export function buildAiClient(_cfg?: AiClientConfig): AiClient {
  return {
    async complete(_params: AiCompleteParams): Promise<AiResponse> {
      throw new NotImplementedError(
        'AiClient.complete is not implemented in Phase 1',
      );
    },
  };
}
