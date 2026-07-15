import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildAiClient } from '../src/lib/ai.js';
import { NotImplementedError } from '../src/lib/errors.js';

/**
 * Unit + structural tests for the INFRA-005 single-seam stubs.
 *
 * StorageClient stub tests (upload/getPresignedUrl/delete throwing
 * NotImplementedError) were removed by INFRA-054, which replaced the stub with
 * a real S3-backed implementation. See tests/infra-054.test.ts for the full
 * StorageClient unit tests.
 *
 * - Grep test: confirm that `src/lib/storage.ts` and `src/lib/ai.ts` are the
 *   ONLY files permitted to import the underlying SDKs.
 * - AI client stub remains here (AiClient is still a stub until a future story).
 */

describe('buildAiClient (default stub)', () => {
  it('returns a client whose complete throws NotImplementedError', async () => {
    const client = buildAiClient();
    await expect(client.complete({ prompt: 'hello' })).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});

describe('SDK import containment (grep)', () => {
  /**
   * Grep the api/src tree for any usage of the restricted SDK package names.
   * Phase 1 has no real SDK imports yet, so the only matches we permit are
   * the seam files themselves (and even those don't import in Phase 1 — the
   * stubs are pure TypeScript). This anchors the policy now so any future
   * accidental SDK pull-in elsewhere is caught by both eslint and a unit
   * test failure.
   */
  function grep(pattern: string): string[] {
    try {
      // -R recursive, -l names-only, --include= for ts files only.
      const out = execSync(
        `grep -RIl --include='*.ts' -E ${JSON.stringify(pattern)} src`,
        {
          cwd: new URL('..', import.meta.url),
          encoding: 'utf8',
        },
      );
      return out
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (err: unknown) {
      // grep exits 1 when there are no matches; treat as empty result.
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status: number }).status
          : undefined;
      if (status === 1) return [];
      throw err;
    }
  }

  it('@aws-sdk imports appear only (if at all) in src/lib/storage.ts', () => {
    const matches = grep(
      "from ['\\\"]@aws-sdk(/.*)?['\\\"]|require\\(['\\\"]@aws-sdk(/.*)?['\\\"]\\)",
    );
    const offenders = matches.filter((p) => p !== 'src/lib/storage.ts');
    expect(offenders).toEqual([]);
  });

  it('@anthropic-ai/sdk imports appear only (if at all) in src/lib/ai.ts', () => {
    const matches = grep(
      "from ['\\\"]@anthropic-ai/sdk(/.*)?['\\\"]|require\\(['\\\"]@anthropic-ai/sdk(/.*)?['\\\"]\\)",
    );
    const offenders = matches.filter((p) => p !== 'src/lib/ai.ts');
    expect(offenders).toEqual([]);
  });
});
