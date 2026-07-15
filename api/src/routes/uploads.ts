/**
 * Upload, read, and delete routes for headshots and resumes (API-065).
 *
 * Self-scoped endpoints (session-gated via requireAuth()):
 *   POST   /api/me/headshot — upload image/jpeg|png|webp; max 5 MB
 *   GET    /api/me/headshot — pre-signed URL (30 min); 404 if no key
 *   POST   /api/me/resume  — upload application/pdf; max 10 MB
 *   GET    /api/me/resume  — pre-signed URL (30 min); 404 if no key
 *   DELETE /api/me/resume  — delete S3 object + null the key; 204
 *
 * Mentor-scoped read:
 *   GET    /api/mentor/applicants/:id/resume — ABAC-gated; 403 without grant
 *
 * All S3 object keys are server-constructed from userId — no client filename
 * reaches the key (no path traversal surface).
 * Storage errors (non-not-found) map to 500/502 with a logged cause.
 *
 * Route file choice: placed in uploads.ts (separate from me.ts) to keep the
 * me routes file readable. Registered in app.ts inside protectedScopePlugin.
 */

import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../services/auth/requireAuth.js';
import { hasMentorGrant } from '../services/auth/abacPredicates.js';
import { getProfileKeys, updateProfileKeys } from '../services/profile.js';
import { ErrorSchema } from './shared-schemas.js';

// Allowed MIME types for headshot uploads, and their S3 key extensions.
const HEADSHOT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const HEADSHOT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const RESUME_MAX_BYTES = 10 * 1024 * 1024;  // 10 MB
const PRESIGN_TTL_SECONDS = 1800;            // 30 min

const UrlResponseSchema = z.object({ url: z.string() });

const uploadsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Register @fastify/multipart inside this plugin scope so it decorates
  // request.file() / request.files() for upload handlers only.
  await fastify.register(multipart, {
    // No global limits here — per-route limits are applied when consuming files.
    limits: { fileSize: RESUME_MAX_BYTES },
  });

  const typed = fastify.withTypeProvider<ZodTypeProvider>();

  // ---------------------------------------------------------------------------
  // POST /api/me/headshot
  // ---------------------------------------------------------------------------
  typed.post(
    '/me/headshot',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: UrlResponseSchema,
          401: ErrorSchema,
          413: ErrorSchema,
          415: ErrorSchema,
          500: ErrorSchema,
          502: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const part = await req.file({ limits: { fileSize: HEADSHOT_MAX_BYTES } });
      if (!part) {
        return reply.status(415).send({ error: 'No file uploaded' });
      }

      // Validate content type
      const ext = HEADSHOT_TYPES[part.mimetype];
      if (!ext) {
        // Drain the stream to avoid hanging the connection
        part.file.resume();
        return reply.status(415).send({ error: 'Unsupported media type — jpeg, png, or webp only' });
      }

      // Read the file into a buffer, respecting the size limit
      let fileBuffer: Buffer;
      try {
        fileBuffer = await part.toBuffer();
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.status(413).send({ error: 'File too large — max 5 MB' });
        }
        req.log.error({ err }, 'headshot upload read error');
        return reply.status(500).send({ error: 'Upload failed' });
      }

      const userId = req.user!.id;
      const key = `headshots/${userId}.${ext}`;

      // Best-effort: delete the old object if the key extension changed
      const existingKeys = await getProfileKeys(userId);
      if (existingKeys?.headshotKey && existingKeys.headshotKey !== key) {
        try {
          await req.server.storageClient.delete(existingKeys.headshotKey);
        } catch {
          // best-effort, ignore
        }
      }

      try {
        await req.server.storageClient.upload(key, fileBuffer, part.mimetype);
      } catch (err) {
        req.log.error({ err }, 'headshot S3 upload error');
        return reply.status(502).send({ error: 'Storage error' });
      }

      await updateProfileKeys(userId, { headshotKey: key });

      const url = await req.server.storageClient.getSignedUrl(key, PRESIGN_TTL_SECONDS);
      return reply.status(200).send({ url });
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/me/headshot
  // ---------------------------------------------------------------------------
  typed.get(
    '/me/headshot',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: UrlResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const keys = await getProfileKeys(req.user!.id);
      if (!keys?.headshotKey) {
        return reply.status(404).send({ error: 'No headshot on file' });
      }
      try {
        const url = await req.server.storageClient.getSignedUrl(keys.headshotKey, PRESIGN_TTL_SECONDS);
        return reply.status(200).send({ url });
      } catch (err) {
        req.log.error({ err }, 'headshot presign error');
        return reply.status(500).send({ error: 'Storage error' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/me/resume
  // ---------------------------------------------------------------------------
  typed.post(
    '/me/resume',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: UrlResponseSchema,
          401: ErrorSchema,
          413: ErrorSchema,
          415: ErrorSchema,
          500: ErrorSchema,
          502: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const part = await req.file({ limits: { fileSize: RESUME_MAX_BYTES } });
      if (!part) {
        return reply.status(415).send({ error: 'No file uploaded' });
      }

      if (part.mimetype !== 'application/pdf') {
        part.file.resume();
        return reply.status(415).send({ error: 'Unsupported media type — PDF only' });
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await part.toBuffer();
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.status(413).send({ error: 'File too large — max 10 MB' });
        }
        req.log.error({ err }, 'resume upload read error');
        return reply.status(500).send({ error: 'Upload failed' });
      }

      const userId = req.user!.id;
      const key = `resumes/${userId}.pdf`;

      try {
        await req.server.storageClient.upload(key, fileBuffer, 'application/pdf');
      } catch (err) {
        req.log.error({ err }, 'resume S3 upload error');
        return reply.status(502).send({ error: 'Storage error' });
      }

      await updateProfileKeys(userId, { resumeKey: key });

      const url = await req.server.storageClient.getSignedUrl(key, PRESIGN_TTL_SECONDS);
      return reply.status(200).send({ url });
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/me/resume
  // ---------------------------------------------------------------------------
  typed.get(
    '/me/resume',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          200: UrlResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const keys = await getProfileKeys(req.user!.id);
      if (!keys?.resumeKey) {
        return reply.status(404).send({ error: 'No resume on file' });
      }
      try {
        const url = await req.server.storageClient.getSignedUrl(keys.resumeKey, PRESIGN_TTL_SECONDS);
        return reply.status(200).send({ url });
      } catch (err) {
        req.log.error({ err }, 'resume presign error');
        return reply.status(500).send({ error: 'Storage error' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/me/resume
  // ---------------------------------------------------------------------------
  typed.delete(
    '/me/resume',
    {
      preHandler: [requireAuth()],
      schema: {
        response: {
          204: z.undefined(),
          401: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const keys = await getProfileKeys(req.user!.id);
      if (!keys?.resumeKey) {
        return reply.status(404).send({ error: 'No resume on file' });
      }
      // Best-effort S3 delete
      try {
        await req.server.storageClient.delete(keys.resumeKey);
      } catch (err) {
        req.log.error({ err }, 'resume S3 delete error');
        // Continue to null the DB key even if S3 delete fails
      }
      await updateProfileKeys(req.user!.id, { resumeKey: null });
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/mentor/applicants/:id/resume
  // ABAC-gated: hasMentorGrant(caller, applicantId, 'read')
  // ---------------------------------------------------------------------------
  typed.get(
    '/mentor/applicants/:id/resume',
    {
      preHandler: [requireAuth()],
      schema: {
        params: z.object({ id: z.string().min(1) }),
        response: {
          200: UrlResponseSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const applicantUserId = req.params.id;
      const granted = await hasMentorGrant(req.user!.id, applicantUserId, 'read');
      if (!granted) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const keys = await getProfileKeys(applicantUserId);
      if (!keys?.resumeKey) {
        return reply.status(404).send({ error: 'No resume on file' });
      }
      try {
        const url = await req.server.storageClient.getSignedUrl(keys.resumeKey, PRESIGN_TTL_SECONDS);
        return reply.status(200).send({ url });
      } catch (err) {
        req.log.error({ err }, 'mentor resume presign error');
        return reply.status(500).send({ error: 'Storage error' });
      }
    },
  );
};

export default uploadsRoutes;
