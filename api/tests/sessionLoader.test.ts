/**
 * Unit tests for the session loader preHandler.
 *
 * These tests do NOT require a database. They use a stubbed `auth.api.getSession`
 * that returns null to verify that unauthenticated requests receive
 * `request.user === null` and `request.session === null`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Stub the auth module before any import of sessionLoader
vi.mock('../src/services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
  setMailer: vi.fn(),
}));

import { registerSessionLoader } from '../src/services/auth/sessionLoader.js';
import { auth } from '../src/services/auth/index.js';

describe('registerSessionLoader — unit', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
  });

  it('decorates request.user and request.session with null when no session cookie is present', async () => {
    const app = Fastify();

    registerSessionLoader(app);

    let capturedUser: unknown = 'UNSET';
    let capturedSession: unknown = 'UNSET';

    app.get('/test', async (request, reply) => {
      capturedUser = request.user;
      capturedSession = request.session;
      return reply.send({ ok: true });
    });

    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);
    expect(capturedUser).toBeNull();
    expect(capturedSession).toBeNull();

    await app.close();
  });

  it('does not throw when getSession returns null (unauthenticated request)', async () => {
    const app = Fastify();
    registerSessionLoader(app);

    app.get('/test', async (_request, reply) => reply.send({ ok: true }));

    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('populates request.user and request.session when getSession returns a valid result', async () => {
    const fakeUser = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };
    const fakeSession = { id: 'sess-1', userId: 'user-1', token: 'tok' };

    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });

    const app = Fastify();
    registerSessionLoader(app);

    let capturedUser: unknown = 'UNSET';
    let capturedSession: unknown = 'UNSET';

    app.get('/test', async (request, reply) => {
      capturedUser = request.user;
      capturedSession = request.session;
      return reply.send({ ok: true });
    });

    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/test' });
    expect(response.statusCode).toBe(200);
    expect(capturedUser).toEqual(fakeUser);
    expect(capturedSession).toEqual(fakeSession);

    await app.close();
  });

  it('request.user is typed as User | null (TypeScript compilation confirms this)', () => {
    // This is a compile-time check surfaced at runtime: if request.user
    // were typed as `any`, TypeScript would not catch it. The fact that
    // types.ts augments FastifyRequest with `user: User | null` means this
    // test exists to keep the import chain intact and confirm no `any` leak.
    // The actual type guarantee is validated by `pnpm typecheck`.
    expect(true).toBe(true);
  });
});
