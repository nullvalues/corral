import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite config for the @asp/ui package.
 *
 * Port pinning notes:
 * - `port: 6041` sits inside asp's reserved dev port range 6040–6049
 *   (see docs/brief.md → Constraints).
 * - `strictPort: true` is deliberate: if the port is taken, Vite must FAIL
 *   loudly instead of silently drifting to 6042. Port drift hides
 *   "another asp dev server is already running" mistakes.
 *
 * We import `defineConfig` from `vitest/config` (a thin wrapper around
 * `vite`'s `defineConfig`) so the inline `test` block is fully typed without
 * triple-slash references.
 *
 * Environment variables consumed by the UI (read via `import.meta.env`):
 *   - `VITE_API_URL` — base URL of the @asp/api service. Defaults to
 *     `http://localhost:6040` (asp's reserved API port). Used by the
 *     INFRA-006 health-probe placeholder and, later, by the TanStack Query
 *     data layer (UI-002). No special Vite wiring is required: any env var
 *     prefixed `VITE_` is exposed on `import.meta.env` automatically.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 6041,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:6040',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
});
