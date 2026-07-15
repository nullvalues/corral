/**
 * Integration tests for BA account-management endpoints (API-060).
 *
 * Verifies:
 *   - POST /api/auth/change-password: success (new password works, old does not)
 *     and wrong-current-password rejection.
 *   - GET /api/auth/list-sessions: returns the current session with userAgent/
 *     createdAt fields.
 *   - POST /api/auth/revoke-other-sessions: a second session token becomes
 *     invalid; the current session survives.
 *   - POST /api/auth/delete-user: user row is gone; old session is rejected.
 *   - Each endpoint returns 401 without a session cookie.
 *
 * Runs in the "integration" Vitest project (requires DATABASE_URL_TEST).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

const PASSWORD = 'Password123!';

/**
 * Sign up a fresh user and return the session cookie string + userId.
 */
async function signUpAndGetSession(
  app: FastifyInstance,
  email: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'Test User', email, password: PASSWORD }),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  const body = JSON.parse(res.body) as { user?: { id?: string } };
  const userId = body.user?.id ?? '';
  expect(userId).toBeTruthy();
  return { cookie, userId };
}

/**
 * Sign in an existing user and return the session cookie.
 */
async function signIn(app: FastifyInstance, email: string, password: string): Promise<{ cookie: string; status: number }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password }),
  });
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  return { cookie, status: res.statusCode };
}

describe('POST /api/auth/change-password (API-060)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'NewPass456!', revokeOtherSessions: false }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects wrong current password', async () => {
    const email = `api060-cp-wrong+${ts}@example.com`;
    const { cookie } = await signUpAndGetSession(app, email);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { 'content-type': 'application/json', cookie },
      payload: JSON.stringify({ currentPassword: 'WrongPass999!', newPassword: 'NewPass456!' }),
    });
    expect(res.statusCode).not.toBe(200);
  });

  it('success: new password works, old password no longer works', async () => {
    const email = `api060-cp-success+${ts}@example.com`;
    const { cookie } = await signUpAndGetSession(app, email);
    const newPassword = 'NewPass456!';

    // Change password
    const changeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { 'content-type': 'application/json', cookie },
      payload: JSON.stringify({ currentPassword: PASSWORD, newPassword, revokeOtherSessions: false }),
    });
    expect(changeRes.statusCode).toBe(200);

    // Old password should no longer work
    const oldSignIn = await signIn(app, email, PASSWORD);
    expect(oldSignIn.status).not.toBe(200);

    // New password should work
    const newSignIn = await signIn(app, email, newPassword);
    expect(newSignIn.status).toBe(200);
  });
});

describe('GET /api/auth/list-sessions (API-060)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/list-sessions',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the current session with userAgent and createdAt fields', async () => {
    const email = `api060-ls+${ts}@example.com`;
    const { cookie } = await signUpAndGetSession(app, email);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/list-sessions',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    // BA returns sessions in an array — each row has token, createdAt, userAgent
    const session = body[0];
    expect(session).toHaveProperty('createdAt');
    // userAgent may be null when injected via Fastify inject (no real UA header),
    // but the field must be present in the response shape.
    expect('userAgent' in session).toBe(true);
  });
});

describe('POST /api/auth/revoke-other-sessions (API-060)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/revoke-other-sessions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(401);
  });

  it('revokes other sessions but leaves the current session active', async () => {
    const email = `api060-ros+${ts}@example.com`;
    // Session A — the "current" session we will keep
    const { cookie: cookieA } = await signUpAndGetSession(app, email);

    // Session B — a second sign-in session that will be revoked
    const { cookie: cookieB } = await signIn(app, email, PASSWORD);
    expect(cookieB).toBeTruthy();

    // Revoke all OTHER sessions from session A's perspective
    const revokeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/revoke-other-sessions',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      payload: JSON.stringify({}),
    });
    expect(revokeRes.statusCode).toBe(200);

    // Session A should still be valid — GET /api/me returns 200
    const meWithA = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: cookieA },
    });
    expect(meWithA.statusCode).toBe(200);

    // Session B should now be rejected — GET /api/me returns 401
    const meWithB = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: cookieB },
    });
    expect(meWithB.statusCode).toBe(401);
  });
});

describe('POST /api/auth/delete-user (API-060)', () => {
  let app: FastifyInstance;
  const ts = Date.now();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/delete-user',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(401);
  });

  it('deletes the user; subsequent request with the old session is rejected', async () => {
    const email = `api060-du+${ts}@example.com`;
    const { cookie } = await signUpAndGetSession(app, email);

    // Confirm session is valid before deletion
    const meBefore = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(meBefore.statusCode).toBe(200);

    // Delete the account — BA requires password for credential accounts
    const delRes = await app.inject({
      method: 'POST',
      url: '/api/auth/delete-user',
      headers: { 'content-type': 'application/json', cookie },
      payload: JSON.stringify({ password: PASSWORD }),
    });
    expect(delRes.statusCode).toBe(200);

    // After deletion, the old session cookie must no longer authenticate
    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(meAfter.statusCode).toBe(401);
  });
});
