/**
 * Readiness-config routes (API-042, PM036).
 *
 * - GET /api/readiness-config — any authenticated user (no role guard; returns
 *   401 when request.user is absent). Needed client-side to compute readiness.
 * - PUT /api/admin/readiness-config — admin only (requireRole('admin')); body
 *   { wGoal, wVerified, wBreadth, platinumHours? }, weights each in [0, 1].
 *   The API is the authoritative validation point: the sum-to-1.0 check runs
 *   here because direct API calls bypass the UI guard entirely, and persisted
 *   weights that don't sum to 1.0 would silently distort every readiness score
 *   (API-052). platinumHours must be a positive integer (API-063).
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getReadinessConfig, updateReadinessConfig } from '../services/readiness-config.js';
import { requireRole } from '../services/auth/rbacGuard.js';
import { ErrorSchema } from './shared-schemas.js';

const ReadinessConfigSchema = z.object({
  wGoal: z.number().min(0).max(1),
  wVerified: z.number().min(0).max(1),
  wBreadth: z.number().min(0).max(1),
  platinumHours: z.number().int().positive(),
});

const ReadinessConfigBodySchema = ReadinessConfigSchema.superRefine((v, ctx) => {
  if (Math.abs(v.wGoal + v.wVerified + v.wBreadth - 1.0) > 0.001) {
    ctx.addIssue({ code: 'custom', message: 'Weights must sum to 1.0' });
  }
});

const readinessConfigRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/readiness-config',
    {
      schema: {
        response: {
          200: ReadinessConfigSchema,
          401: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      return getReadinessConfig();
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().put(
    '/admin/readiness-config',
    {
      preHandler: requireRole('admin'),
      schema: {
        body: ReadinessConfigBodySchema,
        response: { 200: ReadinessConfigSchema },
      },
    },
    async (req) => {
      return updateReadinessConfig(req.body);
    },
  );
};

export default readinessConfigRoutes;
