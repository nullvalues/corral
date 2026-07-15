import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { searchUsersByEmail, listUsers, setAdminRole, getUserRoles } from '../services/users.js';
import { requireRole } from '../services/auth/rbacGuard.js';
import { insertPiiAccessLog } from '../services/pii-access-log.js';

const usersRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /api/users — dual-mode endpoint (ADR note in docs/architecture.md):
  //   ?email=<prefix>       — typeahead search (≤10 results, minimal shape)
  //   ?page=N&pageSize=M    — paginated full list with roles and grant counts
  // Both branches require admin role.
  typed.get(
    '/users',
    {
      preHandler: requireRole('admin'),
      schema: {
        querystring: z
          .object({
            email: z.string().min(3).optional(),
            page: z.coerce.number().int().min(1).optional(),
            pageSize: z.coerce.number().int().min(1).max(100).optional(),
          })
          .refine(
            (q) => {
              // Must have either email (typeahead) or page+pageSize (list)
              const hasEmail = q.email !== undefined;
              const hasPagination = q.page !== undefined && q.pageSize !== undefined;
              return hasEmail || hasPagination;
            },
            { message: 'Provide either email or page+pageSize' },
          ),
        response: {
          200: z.union([
            z.array(
              z.object({
                id: z.string(),
                email: z.string(),
                name: z.string(),
              }),
            ),
            z.object({
              users: z.array(
                z.object({
                  id: z.string(),
                  email: z.string(),
                  name: z.string(),
                  roles: z.array(z.string()),
                  activeMentorGrantCount: z.number(),
                }),
              ),
              totalCount: z.number(),
              page: z.number(),
              pageSize: z.number(),
            }),
          ]),
        },
      },
    },
    async (req, reply) => {
      const { email, page, pageSize } = req.query as {
        email?: string;
        page?: number;
        pageSize?: number;
      };

      if (page !== undefined && pageSize !== undefined) {
        // Paginated list branch
        const result = await listUsers(page, pageSize);
        return reply.status(200).send({
          users: result.users,
          totalCount: result.totalCount,
          page,
          pageSize,
        });
      }

      // Typeahead branch — email is guaranteed by the refine above
      const results = await searchUsersByEmail(email!);
      for (const user of results) {
        insertPiiAccessLog({
          actorUserId: req.user!.id,
          action: 'read',
          resourceType: 'user',
          resourceId: user.id,
          subjectUserId: user.id,
        });
      }
      return reply.status(200).send(results);
    },
  );

  // PATCH /api/users/:id/roles — admin promote/demote admin role (API-030)
  typed.patch(
    '/users/:id/roles',
    {
      preHandler: requireRole('admin'),
      schema: {
        params: z.object({ id: z.string().min(1).max(36) }),
        body: z.object({
          role: z.literal('admin'),
          action: z.enum(['grant', 'revoke']),
        }),
        response: {
          200: z.object({
            userId: z.string(),
            roles: z.array(z.string()),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id: targetUserId } = req.params as { id: string };
      const { action } = req.body as { role: 'admin'; action: 'grant' | 'revoke' };

      try {
        await setAdminRole(req.user!.id, targetUserId, action);
      } catch (err: unknown) {
        const statusCode = (err as Error & { statusCode?: number }).statusCode;
        if (statusCode === 404) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (reply as any).status(404).send({ error: (err as Error).message });
        }
        if (statusCode === 403) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (reply as any).status(403).send({ error: (err as Error).message });
        }
        if (statusCode === 409) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (reply as any).status(409).send({ error: (err as Error).message });
        }
        throw err;
      }

      // Return updated roles for the target user
      const roles = await getUserRoles(targetUserId);

      return reply.status(200).send({ userId: targetUserId, roles });
    },
  );
};

export default usersRoutes;
