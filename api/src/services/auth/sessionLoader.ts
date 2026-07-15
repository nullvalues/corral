import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { UserWithTwoFactor } from 'better-auth/plugins/two-factor';
import { auth } from './index.js';

/**
 * Convert Node.js IncomingHttpHeaders to a HeadersInit-compatible object.
 *
 * `IncomingHttpHeaders` values are `string | string[] | undefined`.
 * The Fetch API's `HeadersInit` (used by Better Auth's `getSession`) requires
 * `string` values. Multi-value headers are joined with ", " per HTTP spec.
 */
function toHeadersInit(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

export function registerSessionLoader(fastify: FastifyInstance) {
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('session', null);
  fastify.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    const result = await auth.api.getSession({ headers: toHeadersInit(request.headers) });
    // Cast to UserWithTwoFactor: the twoFactor plugin adds twoFactorEnabled to
    // the user object at runtime. BA's generic getSession return type is not
    // narrowed to plugin-augmented shapes, so we cast here. The field is always
    // present when the twoFactor plugin is registered (AUTH-003 / AUTH-004).
    request.user = (result?.user as UserWithTwoFactor | undefined) ?? null;
    request.session = result?.session ?? null;
  });
}
