// Flag workflow routes (API-059).
//
// POST /api/experiences/:id/flag — reviewer write path, ABAC-gated: the caller
// must hold an active mentor grant ('read') over the experience's owner. A POST
// against a non-existent experience ID returns 403, NOT 404 — identical to the
// no-grant response, so which experience IDs exist is never disclosed
// (non-disclosure, CER-035 precedent — same as the verification endpoint).
//
// GET /api/admin/flags + PATCH /api/admin/flags/:id — admin paths, RBAC-gated
// via requireRole('admin'). The PATCH performs the open → resolved transition;
// without it, flag_report.status has no writable transition (UI-101 depends on
// it for the "Mark resolved" action).
//
// IMPORTANT: No module-scope db import — db is accessed through the service
// layer only (see milestone-awards.ts / pii-access-log.ts header rationale).

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createFlag, listFlags, resolveFlag } from '../services/flags.js';
import { getExperienceById } from '../services/experiences.js';
import { hasMentorGrant } from '../services/auth/abacPredicates.js';
import { requireAuth } from '../services/auth/requireAuth.js';
import { requireRole } from '../services/auth/rbacGuard.js';
import { ErrorSchema } from './shared-schemas.js';

const FlagReportSchema = z.object({
  id: z.string().uuid(),
  reviewerUserId: z.string(),
  experienceId: z.string().uuid(),
  reason: z.string(),
  status: z.string(),
  resolvedByUserId: z.string().nullable(),
  resolvedAt: z.date().nullable(),
  createdAt: z.date(),
});

// Admin list row: flag + experience join (org, position, ownerUserId) +
// reviewer join (name, email). Joined fields are nullable — LEFT JOIN survives
// a deleted experience or reviewer row.
const FlagListRowSchema = FlagReportSchema.extend({
  organization: z.string().nullable(),
  position: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  reviewerName: z.string().nullable(),
  reviewerEmail: z.string().nullable(),
});

const FlagBody = z.object({
  reason: z.string().max(1024),
});

const flagsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /api/experiences/:id/flag — reviewer creates a flag on an experience
  // they can see (active mentor grant over the experience's owner).
  typed.post(
    '/experiences/:id/flag',
    {
      preHandler: [requireAuth()],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: FlagBody,
        response: {
          201: FlagReportSchema,
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const experience = await getExperienceById(req.params.id);
      // Non-existent experience and missing grant collapse to an identical 403
      // (non-disclosure, CER-035 precedent).
      if (!experience) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const granted = await hasMentorGrant(req.user!.id, experience.ownerUserId, 'read');
      if (!granted) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const row = await createFlag(req.user!.id, req.params.id, req.body.reason);
      return reply.status(201).send(row);
    },
  );

  // GET /api/admin/flags — admin-only flag listing with optional status filter
  // and limit/offset pagination.
  typed.get(
    '/admin/flags',
    {
      preHandler: requireRole('admin'),
      schema: {
        querystring: z.object({
          status: z.enum(['open', 'resolved']).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
        response: {
          200: z.array(FlagListRowSchema),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const rows = await listFlags({
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return reply.status(200).send(rows);
    },
  );

  // PATCH /api/admin/flags/:id — admin resolves a flag (open → resolved).
  typed.patch(
    '/admin/flags/:id',
    {
      preHandler: requireRole('admin'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: FlagReportSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const row = await resolveFlag(req.params.id, req.user!.id);
      if (!row) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.status(200).send(row);
    },
  );
};

export default flagsRoutes;
