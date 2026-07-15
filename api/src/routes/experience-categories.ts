import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listCategories, createCategory, updateCategory, deleteCategory, getCategoryById } from '../services/experience-categories.js';
import { requireRole } from '../services/auth/rbacGuard.js';
import { insertAdminActionLog } from '../services/adminActionLog.js';
import { ErrorSchema } from './shared-schemas.js';

const ExperienceCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  goalHours: z.number().int().nonnegative().nullable(),
  createdAt: z.date(),
});

const SLUG_REGEX = /^[a-z][a-z0-9-]{0,63}$/;

const CreateCategoryBody = z.object({
  slug: z.string().regex(SLUG_REGEX),
  name: z.string().min(1).max(128),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  goalHours: z.number().int().nonnegative().nullable().optional(),
});

const PatchCategoryBody = CreateCategoryBody.partial();

const experienceCategoriesRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/experience-categories',
    {
      schema: {
        response: {
          200: z.array(ExperienceCategorySchema),
          401: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      return listCategories();
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/experience-categories',
    {
      preHandler: requireRole('admin'),
      schema: {
        body: CreateCategoryBody,
        response: { 201: ExperienceCategorySchema },
      },
    },
    async (req, reply) => {
      const category = await createCategory(req.body);

      await insertAdminActionLog({
        actorUserId: req.user!.id,
        action: 'category_create',
        resourceType: 'experience_category',
        resourceId: category.id,
        after: category,
      });

      return reply.status(201).send(category);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/experience-categories/:id',
    {
      preHandler: requireRole('admin'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: PatchCategoryBody,
        response: { 200: ExperienceCategorySchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const existing = await getCategoryById(req.params.id);
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      const category = await updateCategory(req.params.id, req.body);
      if (!category) return reply.status(404).send({ error: 'Not found' });

      await insertAdminActionLog({
        actorUserId: req.user!.id,
        action: 'category_update',
        resourceType: 'experience_category',
        resourceId: req.params.id,
        before: existing,
        after: category,
      });

      return category;
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/experience-categories/:id',
    {
      preHandler: requireRole('admin'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: z.undefined(),
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const existingCategory = await getCategoryById(req.params.id);
      if (!existingCategory) return reply.status(404).send({ error: 'Not found' });
      const result = await deleteCategory(req.params.id);
      if (result.outcome === 'not_found') return reply.status(404).send({ error: 'Not found' });
      if (result.outcome === 'in_use') {
        return reply
          .status(409)
          .send({ error: 'Cannot delete a category that has experiences assigned to it.' });
      }

      await insertAdminActionLog({
        actorUserId: req.user!.id,
        action: 'category_delete',
        resourceType: 'experience_category',
        resourceId: req.params.id,
        before: existingCategory,
        after: null,
      });

      return reply.status(204).send();
    },
  );
};

export default experienceCategoriesRoutes;
