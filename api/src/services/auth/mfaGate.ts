import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../lib/config.js';

/**
 * MFA grace-window gate.
 *
 * Four branches (in order):
 *  1. MFA_ENABLED=false  → short-circuit allow (gate disabled globally)
 *  2. null user          → allow (unauthenticated — auth routes handle it)
 *  3. twoFactorEnabled   → allow (user has enrolled)
 *  4. within grace       → allow (new account, still within enrolment window)
 *  5. past grace         → 403 with enrolment hint
 */
export async function mfaGate(request: FastifyRequest, reply: FastifyReply) {
  if (!config.MFA_ENABLED) return;

  const user = request.user;
  if (!user) return;

  if (user.twoFactorEnabled) return;

  const createdAt = new Date(user.createdAt).getTime();
  const elapsedHours = (Date.now() - createdAt) / 3_600_000;

  if (elapsedHours < config.MFA_GRACE_HOURS) return;

  return reply.code(403).send({
    code: 'MFA_REQUIRED',
    enrolmentUrl: '/api/auth/two-factor/enable',
  });
}
