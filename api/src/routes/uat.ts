/**
 * UAT-only routes — UAT-005.
 *
 * Registered only when `config.uat === true`. When `UAT` is unset or false
 * the module still exports a no-op plugin so `app.ts` can always import it;
 * the route simply is never registered.
 *
 * No auth prehandler — the route is gated at the environment level only.
 * UAT environments do not have a stable admin session before the harness
 * is set up.
 *
 * Layer: routes/ → lib/ is permitted by the layer model. We import
 * `getResetLinks` from the console adapter directly (lib layer); this is
 * allowed because routes/ may import from lib/.
 */

import type { FastifyPluginAsync } from 'fastify';
import { config } from '../lib/config.js';
import { getResetLinks } from '../lib/mailerAdapters/console.js';

const uatRoutes: FastifyPluginAsync = async (fastify) => {
  if (!config.UAT) {
    // UAT mode is disabled — register nothing; callers will get 404.
    return;
  }

  fastify.get('/api/uat/reset-links', async (_request, reply) => {
    return reply.send(getResetLinks());
  });
};

export default uatRoutes;
