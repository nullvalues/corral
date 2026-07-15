import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Structural ordering test for the single-command UAT runner.
 *
 * TEST-032 requires that `e2e/uat/run-uat.ts` invokes `pnpm uat:setup`
 * AFTER `pnpm seed:uat` completes and BEFORE the Playwright invocation, so
 * that the pre-authenticated storageState files required by
 * `workflow-smoke.spec.ts` exist when Playwright starts.
 *
 * The runner is a process-orchestration script that spawns dev servers and
 * child commands; it has no in-process unit surface. We assert the ordering
 * invariant structurally by grepping the source — the same pattern used by
 * `index-shape.test.ts`. The relative path is resolved from `__file__` so the
 * test is portable.
 */
describe('e2e/uat/run-uat.ts step ordering', () => {
  const RUNNER_PATH = resolve(
    __dirname,
    '..',
    '..',
    'e2e',
    'uat',
    'run-uat.ts',
  );
  const source = readFileSync(RUNNER_PATH, 'utf8');

  const seedIdx = source.indexOf("'seed:uat'");
  const setupIdx = source.indexOf("'uat:setup'");
  // The Playwright run is a spawnInherited('pnpm', ['exec', 'playwright', ...]).
  const playwrightIdx = source.indexOf("'playwright'");

  it('invokes seed:uat, uat:setup, and playwright', () => {
    expect(seedIdx, 'run-uat.ts must invoke seed:uat').toBeGreaterThanOrEqual(0);
    expect(setupIdx, 'run-uat.ts must invoke uat:setup').toBeGreaterThanOrEqual(0);
    expect(playwrightIdx, 'run-uat.ts must invoke playwright').toBeGreaterThanOrEqual(0);
  });

  it('runs uat:setup after seed:uat', () => {
    expect(setupIdx).toBeGreaterThan(seedIdx);
  });

  it('runs uat:setup before the playwright invocation', () => {
    expect(setupIdx).toBeLessThan(playwrightIdx);
  });

  it('passes the same childEnv to uat:setup as to seed:uat', () => {
    // Both spawnInherited calls forward `env: childEnv`. The playwright call
    // uses a derived `playwrightEnv` instead, so we assert there are at least
    // two `env: childEnv` forwardings (seed + setup) in the source.
    const matches = source.match(/env:\s*childEnv/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('exits 1 when uat:setup fails, before reaching playwright', () => {
    // The failure guard for setup must appear between the setup invocation and
    // the playwright invocation, and must call process.exit(1).
    const setupBlock = source.slice(setupIdx, playwrightIdx);
    expect(setupBlock).toMatch(/setupExit\s*!==\s*0/);
    expect(setupBlock).toMatch(/process\.exit\(1\)/);
  });
});
