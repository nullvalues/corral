/**
 * Integration tests for the session loader preHandler.
 *
 * These tests run in the "integration" Vitest project (TEST-001), which
 * requires DATABASE_URL_TEST and applies all Drizzle migrations via globalSetup
 * before the first test. No graceful skip — if DATABASE_URL_TEST is absent,
 * globalSetup throws a clear error.
 *
 * Tests verify that:
 *   - After sign-up + sign-in, a request to a protected route with the session
 *     cookie has request.user.id matching the signed-in user.
 *   - A request with an invalid/stale cookie gets request.user === null.
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerSessionLoader } from '../src/services/auth/sessionLoader.js';

describe('sessionLoader integration', () => {
  /**
   * Helper: sign up a new user and sign in, returning the session cookie
   * and the user's id.
   */
  async function signUpSignIn(
    app: Awaited<ReturnType<typeof buildApp>>,
  ): Promise<{ sessionCookie: string; userId: string }> {
    const email = `sl+${Date.now()}@example.com`;

    const signUpRes = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'SL User', email, password: 'Password123!' }),
    });
    expect(signUpRes.statusCode).toBe(200);
    const body = JSON.parse(signUpRes.body) as { user?: { id?: string } };
    const userId = body.user?.id ?? '';
    expect(userId).toBeTruthy();

    // Sign-up itself sets a session cookie
    const raw = signUpRes.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    const sessionCookie = cookies
      .map((c) => c.split(';')[0])
      .join('; ');

    return { sessionCookie, userId };
  }

  it('request.user.id matches the signed-in user on a protected route', async () => {
    const app = await buildApp();

    // Create a mini sub-scope with the session loader registered
    let capturedUserId: string | null = 'UNSET';
    app.register(async (scope) => {
      registerSessionLoader(scope);
      scope.get('/test-protected', async (request, reply) => {
        capturedUserId = request.user?.id ?? null;
        return reply.send({ ok: true });
      });
    });

    await app.ready();

    const { sessionCookie, userId } = await signUpSignIn(app);

    const response = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { cookie: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedUserId).toBe(userId);

    await app.close();
  });

  it('request.user is null when a stale/invalid cookie is sent', async () => {
    const app = await buildApp();

    let capturedUser: unknown = 'UNSET';
    app.register(async (scope) => {
      registerSessionLoader(scope);
      scope.get('/test-protected', async (request, reply) => {
        capturedUser = request.user;
        return reply.send({ ok: true });
      });
    });

    await app.ready();

    // Send a deliberately invalid session cookie
    const response = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { cookie: 'better-auth.session_token=invalid-stale-token-xyz' },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedUser).toBeNull();

    await app.close();
  });

  it('request.user is null when no cookie is sent', async () => {
    const app = await buildApp();

    let capturedUser: unknown = 'UNSET';
    let capturedSession: unknown = 'UNSET';

    app.register(async (scope) => {
      registerSessionLoader(scope);
      scope.get('/test-protected', async (request, reply) => {
        capturedUser = request.user;
        capturedSession = request.session;
        return reply.send({ ok: true });
      });
    });

    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/test-protected',
    });

    expect(response.statusCode).toBe(200);
    expect(capturedUser).toBeNull();
    expect(capturedSession).toBeNull();

    await app.close();
  });
});
