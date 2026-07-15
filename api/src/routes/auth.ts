import type { FastifyInstance } from 'fastify';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../services/auth/index.js';

export async function authRoutes(fastify: FastifyInstance) {
  // Better Auth's toNodeHandler reads the raw Node request stream. Fastify's default JSON
  // parser would drain request.raw before our handler runs, leaving BA an undefined body.
  // Register a pass-through parser IN THIS ENCAPSULATED SCOPE so the raw stream is preserved.
  // Scoped to /api/auth/* only — root + Phase 6 routes keep normal JSON parsing (they use
  // fastify-type-provider-zod). See ADR-009 in docs/architecture.md.
  fastify.addContentTypeParser('application/json', (_req, _payload, done) => done(null, null));

  const handler = toNodeHandler(auth);
  fastify.all('/api/auth/*', async (request, reply) => {
    reply.hijack();
    await handler(request.raw, reply.raw);
  });
}
