/**
 * Unit tests for the RBAC guard (requireRole) preHandler factory.
 *
 * No database required. The Drizzle db module is fully mocked so these tests
 * exercise the four behavioural branches in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Declare the limitMock with vi.hoisted() so it is available in the vi.mock
// factory, which is hoisted to the top of the module by Vitest's transformer.
// Without vi.hoisted(), any variable declared before vi.mock() is not yet
// initialised when the factory runs (temporal dead zone / hoisting order).
// ---------------------------------------------------------------------------

const { limitMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
}));

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: limitMock,
  },
}));

import { requireRole, denyRole } from '../src/services/auth/rbacGuard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(user: { id: string } | null): FastifyRequest {
  return { user } as unknown as FastifyRequest;
}

function makeReply(): {
  code: (n: number) => { send: (body: unknown) => void };
  statusCode: number;
  body: unknown;
  codeCalled: number | null;
} {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    codeCalled: null as number | null,
    code(n: number) {
      reply.codeCalled = n;
      return {
        send(b: unknown) {
          reply.body = b;
        },
      };
    },
  };
  return reply;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requireRole — 4 branches', () => {
  beforeEach(() => {
    limitMock.mockReset();
  });

  it('replies 401 when there is no session (user is null)', async () => {
    const handler = requireRole('admin');
    const request = makeRequest(null);
    const reply = makeReply();

    await handler(request, reply as unknown as FastifyReply);

    expect(reply.codeCalled).toBe(401);
    expect(reply.body).toEqual({ error: 'Unauthorized' });
  });

  it('calls next (does not reply with error) when user has the required role', async () => {
    limitMock.mockResolvedValueOnce([{ userId: 'u1', role: 'admin' }]);

    const handler = requireRole('admin');
    const request = makeRequest({ id: 'u1' });
    const reply = makeReply();

    await handler(request, reply as unknown as FastifyReply);

    // No error reply was sent — preHandler returned without calling reply.code()
    expect(reply.codeCalled).toBeNull();
    expect(reply.body).toBeUndefined();
  });

  it('replies 403 when user lacks the required role', async () => {
    limitMock.mockResolvedValueOnce([]);

    const handler = requireRole('admin');
    const request = makeRequest({ id: 'u1' });
    const reply = makeReply();

    await handler(request, reply as unknown as FastifyReply);

    expect(reply.codeCalled).toBe(403);
    expect(reply.body).toEqual({ error: 'Forbidden' });
  });

  it('403 body does NOT contain the role name (no privilege information leak)', async () => {
    limitMock.mockResolvedValueOnce([]);

    const handler = requireRole('admin');
    const request = makeRequest({ id: 'u1' });
    const reply = makeReply();

    await handler(request, reply as unknown as FastifyReply);

    const bodyStr = JSON.stringify(reply.body);
    expect(bodyStr).not.toContain('admin');
    expect(bodyStr).not.toContain('applicant');
  });
});

describe('denyRole — 4 branches', () => {
  beforeEach(() => {
    limitMock.mockReset();
  });

  it('replies 401 when there is no session (user is null)', async () => {
    const handler = denyRole('admin');
    const request = makeRequest(null);
    const reply = makeReply();

    await handler(request, reply as unknown as FastifyReply);

    expect(reply.codeCalled).toBe(401);
    expect(reply.body).toEqual({ error: 'Unauthorized' });
  });

  it('replies 403 when user has the denied role', async () => {
    limitMock.mockResolvedValueOnce([{ userId: 'u1', role: 'admin' }]);

    const handler = denyRole('admin');
    const request = makeRequest({ id: 'u1' });
    const reply = makeReply();

    await handler(request, reply as unknown as FastifyReply);

    expect(reply.codeCalled).toBe(403);
    expect(reply.body).toEqual({ error: 'Forbidden' });
  });

  it('calls next (does not reply with error) when user does NOT have the denied role', async () => {
    limitMock.mockResolvedValueOnce([]);

    const handler = denyRole('admin');
    const request = makeRequest({ id: 'u1' });
    const reply = makeReply();

    await handler(request, reply as unknown as FastifyReply);

    expect(reply.codeCalled).toBeNull();
    expect(reply.body).toBeUndefined();
  });

  it('403 body does NOT contain the role name (no privilege information leak)', async () => {
    limitMock.mockResolvedValueOnce([{ userId: 'u1', role: 'admin' }]);

    const handler = denyRole('admin');
    const request = makeRequest({ id: 'u1' });
    const reply = makeReply();

    await handler(request, reply as unknown as FastifyReply);

    const bodyStr = JSON.stringify(reply.body);
    expect(bodyStr).not.toContain('admin');
    expect(bodyStr).not.toContain('applicant');
  });
});
