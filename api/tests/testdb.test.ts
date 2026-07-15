/**
 * Unit tests for api/src/db/testdb.ts — safety guard assertions.
 *
 * Runs in the 'unit' Vitest project (no live DB required). The unit project
 * pre-seeds:
 *   NODE_ENV=test
 *   DATABASE_URL=postgresql://asp:asp@localhost:5432/asp  (no DATABASE_URL_TEST)
 *
 * Because DATABASE_URL_TEST is absent, db/index.ts falls back to DATABASE_URL,
 * so pool.options.database === 'asp' — which does NOT contain 'test'.
 *
 * Expected behaviour: every destructive function (fullClean, dataClean, wipe)
 * immediately throws the safety-guard error before executing any SQL.
 * postgres-js is lazy (no connection until a query runs), so reading
 * pool.options.database is safe without a reachable database.
 *
 * seed() is also guarded, but because it is currently a no-op after the guard,
 * testing the guard on one representative call is sufficient.
 */

import { describe, expect, it } from 'vitest';
import { dataClean, fullClean, wipe, seed } from '../src/db/testdb.js';

describe('testdb — safety guard (unit project, database = asp, no "test" substring)', () => {
  it('dataClean() throws when pool.options.database does not contain "test"', async () => {
    await expect(dataClean()).rejects.toThrow(/does not contain 'test'/);
  });

  it('fullClean() throws when pool.options.database does not contain "test"', async () => {
    await expect(fullClean()).rejects.toThrow(/does not contain 'test'/);
  });

  it('wipe([...]) throws when pool.options.database does not contain "test"', async () => {
    await expect(wipe(['some_table'])).rejects.toThrow(/does not contain 'test'/);
  });

  it('seed() throws when pool.options.database does not contain "test"', async () => {
    await expect(seed()).rejects.toThrow(/does not contain 'test'/);
  });

  it('guard message names the actual DB name', async () => {
    await expect(dataClean()).rejects.toThrow(/connected database is 'asp'/);
  });

  it('guard message mentions DATABASE_URL_TEST guidance', async () => {
    await expect(dataClean()).rejects.toThrow(/DATABASE_URL_TEST/);
  });
});
