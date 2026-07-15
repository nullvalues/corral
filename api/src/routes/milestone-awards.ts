// GET /api/admin/milestone-awards — admin-only read-only milestone_award listing. UI-081.
// IMPORTANT: No module-scope db import — db is accessed through the service layer only.
// Module-scope db imports cause vi.resetModules() + dynamic import in cors.test.ts /
// rate-limiter.test.ts to hang (5000ms timeout). See pii-access-log.ts header.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listMilestoneAwards,
  listMilestoneConfig,
  updateMilestoneConfig,
} from '../services/milestones.js';
import { requireRole } from '../services/auth/rbacGuard.js';
import { ErrorSchema } from './shared-schemas.js';

const MilestoneAwardRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string().nullable(),
  milestoneKey: z.string(),
  earnedAt: z.date(),
});

// Milestone hour-threshold config (API-064). Bounds mirror the DB CHECKs:
// key ≤ 64 (immutable, not in the PUT body), label 1..128, thresholdHours a
// positive int. isActive/sortOrder are free.
const MilestoneConfigRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  thresholdHours: z.number().int(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});

const MilestoneConfigUpdateSchema = z.object({
  label: z.string().min(1).max(128),
  thresholdHours: z.number().int().positive(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});

const milestoneAwardsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/admin/milestone-awards',
    {
      preHandler: requireRole('admin'),
      schema: {
        querystring: z.object({
          userId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
        response: {
          200: z.array(MilestoneAwardRowSchema),
        },
      },
    },
    async (req, reply) => {
      const rows = await listMilestoneAwards({
        userId: req.query.userId,
        limit: req.query.limit,
      });
      return reply.status(200).send(rows);
    },
  );

  // GET /api/admin/milestone-config — all hour-threshold config rows (active +
  // inactive), ordered by sort_order. Admin-gated. API-064.
  typed.get(
    '/admin/milestone-config',
    {
      preHandler: requireRole('admin'),
      schema: {
        response: {
          200: z.array(MilestoneConfigRowSchema),
        },
      },
    },
    async (_req, reply) => {
      const rows = await listMilestoneConfig();
      return reply.status(200).send(rows);
    },
  );

  // PUT /api/admin/milestone-config/:key — update a config row (label,
  // thresholdHours, isActive, sortOrder). The key is immutable (path param, not
  // in the body). 404 on unknown key. Admin-gated. API-064.
  typed.put(
    '/admin/milestone-config/:key',
    {
      preHandler: requireRole('admin'),
      schema: {
        params: z.object({ key: z.string() }),
        body: MilestoneConfigUpdateSchema,
        response: {
          200: MilestoneConfigRowSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const updated = await updateMilestoneConfig(req.params.key, req.body);
      if (!updated) {
        return reply.status(404).send({ error: 'Milestone config not found' });
      }
      return reply.status(200).send(updated);
    },
  );
};

export default milestoneAwardsRoutes;
