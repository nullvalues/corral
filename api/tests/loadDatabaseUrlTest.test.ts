/**
 * TEST-056 — unit coverage for the cold-shell DATABASE_URL_TEST loader.
 *
 * Verifies the single-key whitelist, quote stripping, no-override and
 * missing-file no-op behaviours that make the documented build gate run from a
 * cold shell without leaking the dev DATABASE_URL / NODE_ENV.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadDatabaseUrlTest,
  parseDatabaseUrlTest,
} from './loadDatabaseUrlTest.js';

const SAMPLE = [
  'NODE_ENV=development',
  'DATABASE_URL=postgresql://asp:dev@db.internal.example:5432/asp',
  'DATABASE_URL_TEST=postgresql://asp:test@db.internal.example:5432/asp_test',
  'SESSION_SECRET=supersecretsupersecretsupersecretsupersecretsupersecretsupersecret',
].join('\n');

describe('parseDatabaseUrlTest', () => {
  it('extracts only the DATABASE_URL_TEST value', () => {
    expect(parseDatabaseUrlTest(SAMPLE)).toBe(
      'postgresql://asp:test@db.internal.example:5432/asp_test',
    );
  });

  it('returns undefined when the key is absent', () => {
    expect(parseDatabaseUrlTest('DATABASE_URL=foo\nNODE_ENV=development')).toBeUndefined();
  });

  it('strips surrounding double quotes', () => {
    expect(parseDatabaseUrlTest('DATABASE_URL_TEST="postgresql://x/test"')).toBe(
      'postgresql://x/test',
    );
  });

  it('strips surrounding single quotes', () => {
    expect(parseDatabaseUrlTest("DATABASE_URL_TEST='postgresql://x/test'")).toBe(
      'postgresql://x/test',
    );
  });

  it('ignores comments and blank lines', () => {
    expect(
      parseDatabaseUrlTest('# comment\n\nDATABASE_URL_TEST=postgresql://x/test\n'),
    ).toBe('postgresql://x/test');
  });

  it('tolerates an export prefix', () => {
    expect(parseDatabaseUrlTest('export DATABASE_URL_TEST=postgresql://x/test')).toBe(
      'postgresql://x/test',
    );
  });
});

describe('loadDatabaseUrlTest', () => {
  let dir: string;
  let envFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'asp-envload-'));
    envFile = path.join(dir, '.env.local');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads DATABASE_URL_TEST and never copies other keys', () => {
    writeFileSync(envFile, SAMPLE);
    const env: NodeJS.ProcessEnv = {};
    loadDatabaseUrlTest(envFile, env);
    expect(env['DATABASE_URL_TEST']).toBe(
      'postgresql://asp:test@db.internal.example:5432/asp_test',
    );
    // The dev DATABASE_URL and NODE_ENV must NOT leak into the test process.
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['NODE_ENV']).toBeUndefined();
    expect(env['SESSION_SECRET']).toBeUndefined();
  });

  it('never overrides an already-exported value', () => {
    writeFileSync(envFile, SAMPLE);
    const env: NodeJS.ProcessEnv = { DATABASE_URL_TEST: 'postgresql://ci/test' };
    loadDatabaseUrlTest(envFile, env);
    expect(env['DATABASE_URL_TEST']).toBe('postgresql://ci/test');
  });

  it('no-ops when the env file is absent', () => {
    const env: NodeJS.ProcessEnv = {};
    loadDatabaseUrlTest(path.join(dir, 'does-not-exist.env'), env);
    expect(env['DATABASE_URL_TEST']).toBeUndefined();
  });
});
