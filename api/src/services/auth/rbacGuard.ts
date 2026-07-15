import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/index.js';
import { systemRoles } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

type Role = 'admin' | 'applicant';

export function requireRole(role: Role) {
  return async function rbacPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const [grant] = await db
      .select()
      .from(systemRoles)
      .where(
        and(
          eq(systemRoles.userId, request.user.id),
          eq(systemRoles.role, role),
        ),
      )
      .limit(1);
    if (!grant) {
      reply.code(403).send({ error: 'Forbidden' });
      return;
    }
  };
}

export function denyRole(role: Role) {
  return async function denyRolePreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const [grant] = await db
      .select()
      .from(systemRoles)
      .where(
        and(
          eq(systemRoles.userId, request.user.id),
          eq(systemRoles.role, role),
        ),
      )
      .limit(1);
    if (grant) {
      reply.code(403).send({ error: 'Forbidden' });
      return;
    }
  };
}
