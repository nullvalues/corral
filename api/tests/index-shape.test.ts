import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(__dirname, '..', 'src', 'index.ts');

/**
 * Structural shape test for `src/index.ts`.
 *
 * INFRA-002 acceptance criterion: index.ts contains ONLY imports, the
 * buildApp() call, env verification, listen(), and SIGINT/SIGTERM handlers.
 * No route registration. No business logic.
 *
 * We grep the file for the forbidden patterns.
 */
describe('src/index.ts shape', () => {
  const source = readFileSync(INDEX_PATH, 'utf8');

  it('contains no route registration calls', () => {
    // Fastify route registration shorthands and the generic .route() method.
    const forbidden = [
      /\bapp\.get\s*\(/,
      /\bapp\.post\s*\(/,
      /\bapp\.put\s*\(/,
      /\bapp\.patch\s*\(/,
      /\bapp\.delete\s*\(/,
      /\bapp\.head\s*\(/,
      /\bapp\.options\s*\(/,
      /\bapp\.route\s*\(/,
    ];
    for (const pattern of forbidden) {
      expect(source, `index.ts must not contain ${pattern}`).not.toMatch(pattern);
    }
  });

  it('does not register plugins (those belong in app.ts)', () => {
    // `app.register(...)` is plugin/route plumbing — belongs in app.ts.
    expect(source).not.toMatch(/\bapp\.register\s*\(/);
  });

  it('calls buildApp and app.listen', () => {
    expect(source).toMatch(/buildApp\s*\(/);
    expect(source).toMatch(/app\.listen\s*\(/);
  });

  it('registers SIGINT and SIGTERM handlers', () => {
    expect(source).toMatch(/SIGINT/);
    expect(source).toMatch(/SIGTERM/);
  });
});
