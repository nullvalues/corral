/**
 * GET /api/me — authenticated user info, roles, and mentor-grant status.
 *
 * NOTE ON PATH: This route is registered at `/me` (not `/auth/me`) because the
 * existing authRoutes registers `fastify.all('/api/auth/*', ...)` on the root
 * Fastify instance. Even though Fastify's radix tree prefers a more-specific
 * method+path over `all`+wildcard, the two registrations live in different
 * encapsulated scopes; in practice the `all` handler fires first and returns
 * a 500 (Better Auth rejects the request) before the protected-scope GET handler
 * is reached. Using `/api/me` avoids the conflict entirely.
 *
 * API-023.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getMyRoles, getHasActiveMentorGrants } from '../services/me.js';
import { getMyMilestones } from '../services/milestones.js';
import { getMyProfile, updateMyProfile } from '../services/profile.js';
import { requireRole } from '../services/auth/rbacGuard.js';
import { requireAuth } from '../services/auth/requireAuth.js';
import { ErrorSchema } from './shared-schemas.js';

const ProfileResponseSchema = z.object({
  name:           z.string(),
  email:          z.string().email(),
  school:         z.string().nullable(),
  graduationYear: z.number().int().nullable(),
  bio:            z.string().nullable(),
  major:          z.string().nullable(),
  gpa:            z.string().nullable(),
  phone:          z.string().nullable(),
  linkedinUrl:    z.string().nullable(),
  portfolioUrl:   z.string().nullable(),
});

const PatchProfileBody = z.object({
  name:           z.string().min(1).max(128).optional(),
  school:         z.string().max(256).nullable().optional(),
  graduationYear: z.number().int().min(2000).max(2100).nullable().optional(),
  bio:            z.string().max(500).nullable().optional(),
  major:          z.string().max(128).nullable().optional(),
  gpa:            z.string().max(8).nullable().optional(),
  phone:          z.string().regex(/^\+[1-9]\d{1,14}$/).nullable().optional(),
  linkedinUrl:    z.string().max(256).nullable().optional()
    .refine(v => v == null || /^https?:\/\//i.test(v), { message: 'Must be an http or https URL' }),
  portfolioUrl:   z.string().max(256).nullable().optional()
    .refine(v => v == null || /^https?:\/\//i.test(v), { message: 'Must be an http or https URL' }),
});

const meRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/me',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: z.object({
            user: z.object({
              id: z.string(),
              email: z.string(),
              name: z.string(),
            }),
            roles: z.array(z.string()),
            hasMentorGrants: z.boolean(),
          }),
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const [roles, hasMentorGrants] = await Promise.all([
        getMyRoles(req.user!.id),
        getHasActiveMentorGrants(req.user!.id),
      ]);
      return reply.status(200).send({
        user: {
          id: req.user!.id,
          email: req.user!.email,
          name: req.user!.name,
        },
        roles,
        hasMentorGrants,
      });
    },
  );
  const MilestoneViewSchema = z.object({
    key: z.string(),
    label: z.string(),
    earned: z.boolean(),
    earnedAt: z.string().nullable(),
    remainingLabel: z.string().nullable(),
  });

  typed.get(
    '/me/milestones',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: z.array(MilestoneViewSchema),
          401: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return reply.status(200).send(await getMyMilestones(req.user!.id));
    },
  );

  typed.get(
    '/me/profile',
    {
      preHandler: [requireRole('applicant')],
      schema: { response: { 200: ProfileResponseSchema, 401: ErrorSchema } },
    },
    async (req, reply) => {
      const profile = await getMyProfile(req.user!.id);
      if (!profile) return reply.status(401).send({ error: 'Unauthorized' });
      return reply.status(200).send(profile);
    },
  );

  typed.patch(
    '/me/profile',
    {
      preHandler: [requireRole('applicant')],
      schema: {
        body: PatchProfileBody,
        response: { 200: ProfileResponseSchema, 401: ErrorSchema, 422: ErrorSchema },
      },
    },
    async (req, reply) => {
      const updated = await updateMyProfile(req.user!.id, req.body);
      if (!updated) return reply.status(401).send({ error: 'Unauthorized' });
      return reply.status(200).send(updated);
    },
  );
};

export default meRoutes;
