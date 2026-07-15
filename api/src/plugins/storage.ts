/**
 * Fastify plugin that decorates the instance with `storageClient`.
 *
 * Wrapped with `fastify-plugin` so the decoration escapes the plugin's
 * encapsulation context and is visible on the root `app.storageClient`
 * handle. This keeps route handlers free of any direct knowledge of where
 * the `StorageClient` was built — they read `fastify.storageClient` and
 * call methods on the seam interface.
 *
 * The composition root (`buildApp`) injects the client through the plugin
 * options: in tests a fake; in `src/index.ts` the default stub (until the
 * real factory ships in a later phase). When no client is supplied, the
 * plugin falls back to `buildStorageClient()` so the decoration is always
 * present and route code never has to null-check.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { buildStorageClient, type StorageClient } from '../lib/storage.js';

export interface StoragePluginOptions {
  /** Optional pre-built client; falls back to `buildStorageClient()`. */
  client?: StorageClient;
}

const storagePlugin: FastifyPluginAsync<StoragePluginOptions> = async (
  fastify: FastifyInstance,
  opts: StoragePluginOptions,
): Promise<void> => {
  const client = opts.client ?? buildStorageClient();
  fastify.decorate('storageClient', client);
};

export default fp(storagePlugin, {
  name: 'asp-storage',
});

declare module 'fastify' {
  interface FastifyInstance {
    /** Object-store seam — see `src/lib/storage.ts`. */
    storageClient: StorageClient;
  }
}
