import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';
import swagger from '@fastify/swagger';
import corsPlugin from './plugins/cors.js';
import helmetPlugin from './plugins/helmet.js';
import rateLimiterPlugin from './plugins/rateLimiter.js';
import staticUiPlugin from './plugins/staticUi.js';
import storagePlugin from './plugins/storage.js';
import aiPlugin from './plugins/ai.js';
import mailerPlugin from './plugins/mailer.js';
import healthRoute from './routes/health.js';
import openapiRoute from './routes/openapi.js';
import { authRoutes } from './routes/auth.js';
import experienceCategoriesRoutes from './routes/experience-categories.js';
import experiencesRoutes from './routes/experiences.js';
import flagsRoutes from './routes/flags.js';
import mentorGrantsRoutes from './routes/mentor-grants.js';
import usersRoutes from './routes/users.js';
import meRoutes from './routes/me.js';
import uploadsRoutes from './routes/uploads.js';
import mentorRoutes from './routes/mentor.js';
import piiAccessLogRoutes from './routes/pii-access-log.js';
import milestoneAwardsRoutes from './routes/milestone-awards.js';
import readinessConfigRoutes from './routes/readiness-config.js';
import uatRoutes from './routes/uat.js';
import { protectedScopePlugin } from './plugins/protectedScope.js';
import { registerSessionLoader } from './services/auth/sessionLoader.js';
import { mfaGate } from './services/auth/mfaGate.js';
import type { StorageClient } from './lib/storage.js';
import type { AiClient } from './lib/ai.js';
import type { MailerClient } from './lib/mailer.js';
import { config } from './lib/config.js';
import { setMailer } from './services/auth/index.js';

/**
 * Options for `buildApp()`.
 *
 * Both client seams are injected so that tests (and future composition roots)
 * can pass fakes. `buildApp()` itself performs ZERO I/O — it does not open
 * sockets, hit the DB, or read the filesystem. The injected clients are
 * stored on the instance for later route handlers to use; they are NOT called
 * at construction time.
 *
 * `StorageClient` and `AiClient` are filled in by INFRA-005: real interfaces
 * with `NotImplementedError`-throwing stub defaults. Provide concrete
 * implementations here in tests to bypass the stubs.
 */
export type BuildAppOptions = {
  storageClient?: StorageClient;
  aiClient?: AiClient;
  mailerClient?: MailerClient;
};

/**
 * Construct a Fastify instance with the app's plugins and routes registered.
 *
 * Contract: NO I/O. No network calls, no DB queries, no filesystem reads.
 * Anything that requires I/O belongs in `src/index.ts` (which calls
 * `app.listen()`) or in a route handler invoked after construction.
 *
 * Storage and AI client seams are registered as Fastify plugins so route
 * handlers can read them as `fastify.storageClient` / `fastify.aiClient`.
 * When no client is supplied via opts, the plugins fall back to the
 * default stub factory (every method throws `NotImplementedError`) so the
 * decoration is always present.
 *
 * Plugin / route registration arrives in later stories — INFRA-006 wired
 * the health route; INFRA-010 wires CORS (registered first below).
 */
export async function buildApp(
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env['NODE_ENV'] === 'test' ? false : { level: 'info' },
  });

  // Wire Zod validator and serializer compilers before any route or plugin
  // registration. Route handlers use fastify.withTypeProvider<ZodTypeProvider>()
  // locally to get typed schemas. API-012.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // OpenAPI spec generation — registered before protectedScopePlugin so the
  // swagger() method is available to the public /api/openapi.json route.
  // Must be registered before any route that should appear in the spec. API-013.
  await app.register(swagger, {
    openapi: {
      info: { title: 'asp API', version: '1.0.0' },
      servers: [{ url: `http://localhost:${config.PORT}` }],
    },
    transform: jsonSchemaTransform,
  });

  // CORS registered first so every route inherits the gate. The plugin
  // IS `fastify-plugin`-wrapped — see api/src/plugins/cors.ts header for
  // the rationale (the @fastify/cors package is itself fp-wrapped
  // internally, so our wrapper must be transparent to propagate its
  // onRequest hook to sibling routes; otherwise routes registered after
  // CORS would not be gated). INFRA-010.
  await app.register(corsPlugin);

  // Security headers (CSP, X-Frame-Options, X-Content-Type-Options, conditional
  // HSTS). Registered between corsPlugin and staticUiPlugin so that security
  // headers apply to both API and static UI responses. INFRA-050.
  await app.register(helmetPlugin);

  // Static SPA serving — no-op when STATIC_UI_ROOT is unset (dev mode).
  // Registered after corsPlugin so CORS headers apply to all responses,
  // including static assets. INFRA-013.
  await app.register(staticUiPlugin);

  await app.register(storagePlugin, { client: opts.storageClient });
  await app.register(aiPlugin, { client: opts.aiClient });
  await app.register(mailerPlugin, { client: opts.mailerClient });
  // Wire the auth service's sendResetPassword callback to the decorated mailer
  // instance. Must come AFTER mailerPlugin registration so app.mailer is defined.
  // AUTH-007.
  setMailer(app.mailer);

  // Public liveness probe — no auth, no DB. INFRA-006.
  await app.register(healthRoute, { prefix: '/api' });

  // Public OpenAPI spec endpoint — no auth required. API-013.
  await app.register(openapiRoute, { prefix: '/api' });

  // Rate limiting for auth endpoints — registered before auth routes so the
  // guard is in place before any auth handler can process the request. API-024.
  await app.register(rateLimiterPlugin);

  // Better Auth HTTP handlers — unauthenticated, outside protected scope. AUTH-001.
  await app.register(authRoutes);

  // Protected scope — session loading + MFA gate applied to all enclosed
  // routes. Registered LAST so that health and auth remain outside the scope.
  // Uses DI pattern: app.ts (composition root) injects service implementations
  // into the plugin; plugins/ may not import from services/ directly (AUTH-004).
  await app.register(protectedScopePlugin, {
    registerSessionLoader,
    mfaGate,
    routePlugins: [experienceCategoriesRoutes, experiencesRoutes, flagsRoutes, mentorGrantsRoutes, usersRoutes, meRoutes, uploadsRoutes, mentorRoutes, piiAccessLogRoutes, milestoneAwardsRoutes, readinessConfigRoutes],
  });

  // UAT-only routes — registered only when config.uat === true.
  // No auth prehandler; gated at the environment level. UAT-005.
  if (config.UAT) {
    await app.register(uatRoutes);
  }

  return app;
}
