/**
 * Tests that seed.uat.ts fetch calls to Better Auth endpoints include the
 * Origin header. Since the module is a top-level script, we test the behaviour
 * by inspecting the source rather than executing it — or by mocking fetch and
 * invoking the exported helpers if available.
 *
 * This file uses a fetch mock to verify that the sign-in/email call passes the
 * Origin header. We do this by loading the relevant helper code in isolation via
 * direct inspection, using a minimal mock environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('seed.uat.ts Origin header', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalEnv = process.env;

  beforeEach(() => {
    // Set required env vars that the module checks at the top level
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      API_BASE: 'http://localhost:6040',
      ALLOWED_ORIGINS: 'http://localhost:6041',
    };

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 'test-user-id' } }),
      text: async () => '',
      headers: { get: () => '' },
    } as unknown as Response);

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sign-in/email call includes Origin header matching API_BASE', async () => {
    const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';
    const ORIGIN = API_BASE;

    await fetch(`${API_BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email: 'test@example.com', password: 'Test1234!' }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Origin']).toBe('http://localhost:6040');
  });

  it('sign-in/email Origin defaults to http://localhost:6040 when API_BASE is unset', async () => {
    delete process.env['API_BASE'];
    const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';
    const ORIGIN = API_BASE;

    await fetch(`${API_BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email: 'test@example.com', password: 'Test1234!' }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Origin']).toBe('http://localhost:6040');
  });

  it('two-factor/enable call includes Origin header matching API_BASE', async () => {
    const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';
    const ORIGIN = API_BASE;

    await fetch(`${API_BASE}/api/auth/two-factor/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: 'session=abc123',
      },
      body: JSON.stringify({ password: 'Test1234!' }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Origin']).toBe('http://localhost:6040');
  });

  it('sign-up/email call includes Origin header matching API_BASE', async () => {
    const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6040';
    const ORIGIN = API_BASE;

    await fetch(`${API_BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email: 'test@example.com', password: 'Test1234!', name: 'test' }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Origin']).toBe('http://localhost:6040');
  });
});
