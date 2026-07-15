/**
 * Unit tests for the MFA grace-window gate and protectedScopePlugin.
 *
 * No database required. Tests exercise the four gate branches and the
 * encapsulation boundary (routes outside the scope remain unaffected).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { mfaGate } from '../src/services/auth/mfaGate.js';
import { protectedScopePlugin } from '../src/plugins/protectedScope.js';
import type { UserWithTwoFactor } from 'better-auth/plugins/two-factor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UserStub = Partial<UserWithTwoFactor> & Pick<UserWithTwoFactor, 'twoFactorEnabled' | 'createdAt' | 'id' | 'email' | 'name' | 'updatedAt' | 'emailVerified'>;

function makeUser(overrides: Partial<UserStub> = {}): UserWithTwoFactor {
  const now = new Date();
  return {
    id: 'u1',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
    twoFactorEnabled: false,
    ...overrides,
  } as UserWithTwoFactor;
}

/**
 * Build a minimal Fastify app with:
 *   - A /public route outside the protected scope
 *   - A /protected route inside an encapsulated child scope with mfaGate
 *   - An optional user injector preHandler on the root
 */
async function buildScopeApp(
  userInjector?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>,
): Promise<FastifyInstance> {
  const app = Fastify();

  // Public route — no gate
  app.get('/public', async (_req, reply) => reply.send({ ok: true }));

  // User injector registered on root scope runs before child preHandlers
  if (userInjector) {
    app.addHook('preHandler', userInjector);
  }

  // Encapsulated child scope with session decorator stubs + mfaGate
  await app.register(async (scope) => {
    scope.decorateRequest('user', null);
    scope.decorateRequest('session', null);
    scope.addHook('preHandler', mfaGate);
    scope.get('/protected', async (_req, reply) => reply.send({ ok: true }));
  });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Branch tests
// ---------------------------------------------------------------------------

describe('mfaGate — 4 branches', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('branch 1: MFA_ENABLED=false → gate short-circuits, allows past-grace unverified user', async () => {
    vi.stubEnv('MFA_ENABLED', 'false');
    // Re-import with fresh module to pick up the new env value
    vi.resetModules();
    const { mfaGate: freshGate } = await import('../src/services/auth/mfaGate.js');

    const app = Fastify();
    const pastGrace = makeUser({ createdAt: new Date(Date.now() - 48 * 3_600_000) });

    app.addHook('preHandler', async (req) => {
      (req as FastifyRequest & { user: UserWithTwoFactor }).user = pastGrace;
    });

    await app.register(async (scope) => {
      scope.decorateRequest('user', null);
      scope.decorateRequest('session', null);
      scope.addHook('preHandler', freshGate);
      scope.get('/protected', async (_req, reply) => reply.send({ ok: true }));
    });

    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('branch 2: null user → gate allows (unauthenticated)', async () => {
    // No user injector → user stays null
    const app = await buildScopeApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('branch 3: twoFactorEnabled=true → gate allows (past grace)', async () => {
    const user = makeUser({
      twoFactorEnabled: true,
      createdAt: new Date(Date.now() - 48 * 3_600_000),
    });

    const app = await buildScopeApp(async (req) => {
      (req as FastifyRequest & { user: UserWithTwoFactor }).user = user;
    });
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('branch 4a: within grace window → gate allows', async () => {
    const user = makeUser({
      twoFactorEnabled: false,
      createdAt: new Date(Date.now() - 1 * 3_600_000), // 1 hour ago, within 24h grace
    });

    const app = await buildScopeApp(async (req) => {
      (req as FastifyRequest & { user: UserWithTwoFactor }).user = user;
    });
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('branch 4b: past grace window → gate returns 403 with MFA_REQUIRED', async () => {
    const user = makeUser({
      twoFactorEnabled: false,
      createdAt: new Date(Date.now() - 48 * 3_600_000), // 48 hours ago, past 24h grace
    });

    const app = await buildScopeApp(async (req) => {
      (req as FastifyRequest & { user: UserWithTwoFactor }).user = user;
    });
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { code: string; enrolmentUrl: string };
    expect(body.code).toBe('MFA_REQUIRED');
    expect(body.enrolmentUrl).toBe('/api/auth/two-factor/enable');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Encapsulation tests
// ---------------------------------------------------------------------------

describe('protectedScopePlugin — encapsulation', () => {
  it('routes outside the protected scope return 200 regardless of MFA state', async () => {
    const user = makeUser({
      twoFactorEnabled: false,
      createdAt: new Date(Date.now() - 48 * 3_600_000),
    });

    const app = await buildScopeApp(async (req) => {
      (req as FastifyRequest & { user: UserWithTwoFactor }).user = user;
    });

    // Public route outside scope: should be 200 even for past-grace user
    const publicRes = await app.inject({ method: 'GET', url: '/public' });
    expect(publicRes.statusCode).toBe(200);

    // Protected route inside scope: should be 403
    const protectedRes = await app.inject({ method: 'GET', url: '/protected' });
    expect(protectedRes.statusCode).toBe(403);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// protectedScopePlugin DI opts wiring
// ---------------------------------------------------------------------------

describe('protectedScopePlugin — DI pattern', () => {
  it('calls registerSessionLoader with the child Fastify instance', async () => {
    const registeredInstances: FastifyInstance[] = [];

    const app = Fastify();
    await app.register(protectedScopePlugin, {
      registerSessionLoader: (fastify) => {
        registeredInstances.push(fastify);
        fastify.decorateRequest('user', null);
        fastify.decorateRequest('session', null);
      },
      mfaGate: async () => { /* no-op */ },
    });

    await app.ready();
    // registerSessionLoader must be called exactly once with the child scope
    expect(registeredInstances).toHaveLength(1);
    await app.close();
  });

  it('addHook("preHandler") is called via the injected mfaGate param', async () => {
    // Verify that protectedScopePlugin wires addHook with the injected gate.
    // We confirm this by checking that a route registered INSIDE the plugin's
    // child scope (via a sub-plugin) receives the gate.
    let gateCallCount = 0;
    const testGate = async (_req: FastifyRequest, _reply: FastifyReply) => {
      gateCallCount++;
    };

    const app = Fastify();

    await app.register(protectedScopePlugin, {
      registerSessionLoader: (fastify) => {
        fastify.decorateRequest('user', null);
        fastify.decorateRequest('session', null);
        // Add a route inside this same child instance so the hook fires
        fastify.get('/inside', async (_req, reply) => reply.send({ ok: true }));
      },
      mfaGate: testGate,
    });

    await app.ready();
    await app.inject({ method: 'GET', url: '/inside' });
    // The gate is a preHandler — it runs before route handlers
    expect(gateCallCount).toBe(1);
    await app.close();
  });
});
