/**
 * Tests for ensureAccount (sign-up-only with 429 retry-backoff) and
 * deleteAccountByEmail in seed-uat-helpers.ts.
 *
 * Verifies that:
 *  - ensureAccount calls sign-up/email directly (no sign-in-first step)
 *  - A 429 response is retried up to 3 total attempts with a configurable delay
 *  - After 3 failed attempts, an informative error is thrown naming the email
 *    and the 429 status
 *  - A 429 followed by a 200 succeeds (returns the user id)
 *  - Non-429 non-2xx status codes throw immediately (no retry)
 *  - The Origin header is preserved on all retry attempts
 *  - deleteAccountByEmail is a no-op when the user does not exist
 *  - deleteAccountByEmail deletes all BA-owned rows when the user exists
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureAccount, deleteAccountByEmail, enrollTotp, writeUatSecrets } from '../src/db/seed-uat-helpers.js';

const MOCK_API_BASE = 'http://localhost:6080';
const MOCK_ORIGIN = 'http://localhost:6080';

// Opts that eliminate the real 2-second delay in unit tests.
const NO_DELAY = { maxAttempts: 3, retryDelayMs: 0 };

// ---------------------------------------------------------------------------
// Helper: build a minimal Response-like mock object
// ---------------------------------------------------------------------------
function makeResponse(
  status: number,
  body: unknown = {},
  extraHeaders: Record<string, string> = {},
): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (name: string) => extraHeaders[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// ensureAccount — sign-up-only with 429 retry logic
// ---------------------------------------------------------------------------

describe('ensureAccount — sign-up-only with 429 retry-backoff', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('returns user id immediately on a 200 sign-up response', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { user: { id: 'user-abc' } }));

    const id = await ensureAccount('test@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, NO_DELAY);
    expect(id).toBe('user-abc');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sign-up/email');
  });

  it('calls sign-up/email directly — no sign-in step', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { user: { id: 'user-direct' } }));

    await ensureAccount('direct@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, NO_DELAY);

    // Exactly one fetch call, and it must be to sign-up — not sign-in
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('/sign-in/email');
    expect(url).toContain('/sign-up/email');
  });

  it('retries once on 429 then succeeds on 200', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { error: 'Too Many Requests' }))
      .mockResolvedValueOnce(makeResponse(200, { user: { id: 'user-retry' } }));

    const id = await ensureAccount('retry@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, NO_DELAY);
    expect(id).toBe('user-retry');
    // First attempt (429) + second attempt (200) = 2 sign-up calls
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const [url] = call as [string, RequestInit];
      expect(url).toContain('/sign-up/email');
    }
  });

  it('throws an informative error after 3 consecutive 429 responses', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { error: 'Too Many Requests' }))
      .mockResolvedValueOnce(makeResponse(429, { error: 'Too Many Requests' }))
      .mockResolvedValueOnce(makeResponse(429, { error: 'Too Many Requests' }));

    await expect(
      ensureAccount('rate@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, NO_DELAY),
    ).rejects.toThrow(/sign-up for rate@example\.com returned 429 after 3 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('thrown 429-exhausted error names the email', async () => {
    fetchMock.mockResolvedValue(makeResponse(429, { error: 'Too Many Requests' }));

    await expect(
      ensureAccount('specific@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, NO_DELAY),
    ).rejects.toThrow('specific@example.com');
  });

  it('throws immediately on a non-429 non-2xx status (e.g. 500)', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(500, { error: 'Server Error' }));

    await expect(
      ensureAccount('err@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, NO_DELAY),
    ).rejects.toThrow(/sign-up for err@example\.com failed 500/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws immediately on a 400 status (account already exists would be a usage error)', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(400, { error: 'User already exists' }));

    await expect(
      ensureAccount('dup@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, NO_DELAY),
    ).rejects.toThrow(/sign-up for dup@example\.com failed 400/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('the Origin header is included on all sign-up attempts including retries', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { error: 'Too Many Requests' }))
      .mockResolvedValueOnce(makeResponse(200, { user: { id: 'user-origin' } }));

    await ensureAccount('origin@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, NO_DELAY);

    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Origin']).toBe(MOCK_ORIGIN);
    }
  });

  // ---------------------------------------------------------------------------
  // Retry-After header tests
  // ---------------------------------------------------------------------------

  it('waits (Retry-After + 1) * 1000 ms when Retry-After header is present and logs the duration', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { error: 'Too Many Requests' }, { 'retry-after': '60' }))
      .mockResolvedValueOnce(makeResponse(200, { user: { id: 'user-ra' } }));

    const promise = ensureAccount('ra@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, { maxAttempts: 3, retryDelayMs: 2000 });
    await vi.runAllTimersAsync();
    const id = await promise;

    expect(id).toBe('user-ra');
    expect(warnSpy).toHaveBeenCalledOnce();
    const warnMessage = warnSpy.mock.calls[0]![0] as string;
    expect(warnMessage).toContain('61000ms');
    expect(warnMessage).toContain('Retry-After: 60s');

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('falls back to retryDelayMs and logs it when no Retry-After header is present', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { error: 'Too Many Requests' }))
      .mockResolvedValueOnce(makeResponse(200, { user: { id: 'user-fb' } }));

    const promise = ensureAccount('fb@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, { maxAttempts: 3, retryDelayMs: 5000 });
    await vi.runAllTimersAsync();
    const id = await promise;

    expect(id).toBe('user-fb');
    expect(warnSpy).toHaveBeenCalledOnce();
    const warnMessage = warnSpy.mock.calls[0]![0] as string;
    expect(warnMessage).toContain('5000ms');
    expect(warnMessage).not.toContain('Retry-After');

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('falls back to retryDelayMs and logs it when Retry-After header is non-numeric', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { error: 'Too Many Requests' }, { 'retry-after': 'banana' }))
      .mockResolvedValueOnce(makeResponse(200, { user: { id: 'user-nan' } }));

    const promise = ensureAccount('nan@example.com', 'Pass1!', MOCK_API_BASE, MOCK_ORIGIN, { maxAttempts: 3, retryDelayMs: 3000 });
    await vi.runAllTimersAsync();
    const id = await promise;

    expect(id).toBe('user-nan');
    expect(warnSpy).toHaveBeenCalledOnce();
    const warnMessage = warnSpy.mock.calls[0]![0] as string;
    expect(warnMessage).toContain('3000ms');
    expect(warnMessage).not.toContain('Retry-After');

    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// enrollTotp — TOTP enrolment via BA API
// ---------------------------------------------------------------------------

describe('enrollTotp', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Mock otplib so we never attempt real crypto in unit tests
    vi.doMock('otplib', () => ({ generateSync: () => '123456' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    vi.doUnmock('otplib');
  });

  it('returns the base32 secret parsed from the totpURI on success', async () => {
    const totpURI = 'otpauth://totp/Test:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Test';

    // sign-in → 200 with session cookie
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
      headers: { get: (name: string) => (name === 'set-cookie' ? 'session=abc; Path=/' : null) },
    } as unknown as Response);

    // two-factor/enable → 200 with totpURI
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ totpURI }),
      text: async () => JSON.stringify({ totpURI }),
      headers: { get: () => null },
    } as unknown as Response);

    // two-factor/verify-totp → 200
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
      headers: { get: () => null },
    } as unknown as Response);

    const secret = await enrollTotp('test@example.com', 'Pass1!', 'http://localhost:6080', 'http://localhost:6080');
    expect(secret).toBe('JBSWY3DPEHPK3PXP');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws when sign-in fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
      headers: { get: () => null },
    } as unknown as Response);

    await expect(
      enrollTotp('bad@example.com', 'wrong', 'http://localhost:6080', 'http://localhost:6080'),
    ).rejects.toThrow(/sign-in for bad@example\.com failed 401/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws when TOTP enable fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
      headers: { get: (name: string) => (name === 'set-cookie' ? 'session=abc; Path=/' : null) },
    } as unknown as Response);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
      headers: { get: () => null },
    } as unknown as Response);

    await expect(
      enrollTotp('t@example.com', 'Pass1!', 'http://localhost:6080', 'http://localhost:6080'),
    ).rejects.toThrow(/TOTP enable for t@example\.com failed 400/);
  });

  it('throws when TOTP verify fails', async () => {
    const totpURI = 'otpauth://totp/Test:t@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Test';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
      headers: { get: (name: string) => (name === 'set-cookie' ? 'session=abc; Path=/' : null) },
    } as unknown as Response);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ totpURI }),
      text: async () => JSON.stringify({ totpURI }),
      headers: { get: () => null },
    } as unknown as Response);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => 'Invalid code',
      headers: { get: () => null },
    } as unknown as Response);

    await expect(
      enrollTotp('t@example.com', 'Pass1!', 'http://localhost:6080', 'http://localhost:6080'),
    ).rejects.toThrow(/TOTP verify for t@example\.com failed 422/);
  });

  it('forwards the session cookie from sign-in to enable and verify', async () => {
    const totpURI = 'otpauth://totp/Test:t@example.com?secret=ABCDE12345&issuer=Test';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
      headers: { get: (name: string) => (name === 'set-cookie' ? 'session=mysession; Path=/' : null) },
    } as unknown as Response);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ totpURI }),
      text: async () => JSON.stringify({ totpURI }),
      headers: { get: () => null },
    } as unknown as Response);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
      headers: { get: () => null },
    } as unknown as Response);

    await enrollTotp('t@example.com', 'Pass1!', 'http://localhost:6080', 'http://localhost:6080');

    // enable call (index 1) and verify call (index 2) must carry the cookie
    for (const callIdx of [1, 2]) {
      const [, init] = fetchMock.mock.calls[callIdx] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Cookie']).toBe('session=mysession');
    }
  });
});

// ---------------------------------------------------------------------------
// writeUatSecrets — sidecar file writer
// ---------------------------------------------------------------------------

describe('writeUatSecrets', () => {
  it('writes a JSON sidecar with correct shape and path', () => {
    // writeUatSecrets calls fs.writeFileSync to a path derived from __dirname.
    // In ESM, we cannot spy on node:fs exports.  Instead we let it write for
    // real (the monorepo root e2e/uat/ directory is always present in the dev
    // tree) and then read back and assert the content.
    // Resolve from this test file's location:
    //   api/tests/ → ../../ → monorepo root
    const expectedPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),  // api/tests/
      '../../',                                          // monorepo root (api/tests → api → asp)
      'e2e/uat/.uat-secrets.json',
    );

    const secrets = {
      applicant: { email: 'uat-applicant@asp.dev', totpSecret: 'SECRET_A' },
      mentor:    { email: 'uat-mentor@asp.dev',    totpSecret: 'SECRET_M' },
      admin:     { email: 'uat-admin@asp.dev',     totpSecret: 'SECRET_X' },
    };

    writeUatSecrets(secrets);

    expect(fs.existsSync(expectedPath)).toBe(true);

    const raw = fs.readFileSync(expectedPath, 'utf8');
    const parsed = JSON.parse(raw) as typeof secrets;

    expect(parsed.applicant.email).toBe('uat-applicant@asp.dev');
    expect(parsed.applicant.totpSecret).toBe('SECRET_A');
    expect(parsed.mentor.totpSecret).toBe('SECRET_M');
    expect(parsed.admin.totpSecret).toBe('SECRET_X');
  });
});

// ---------------------------------------------------------------------------
// deleteAccountByEmail — DB helper
// ---------------------------------------------------------------------------

describe('deleteAccountByEmail', () => {
  it('is a no-op when the user does not exist', async () => {
    // Mock a DB that returns an empty select result
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockReturnThis(),
    };

    // Should not throw
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deleteAccountByEmail(mockDb as any, 'nonexistent@example.com'),
    ).resolves.toBeUndefined();
  });

  it('deletes all BA-owned rows when the user exists', async () => {
    // We need a mock that chains select().from().where() → [{ id: 'u1' }]
    // then each delete().where() → void.
    const selectResult = [{ id: 'u1' }];
    const deleteChain = { where: vi.fn().mockResolvedValue(undefined) };

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(selectResult),
        }),
      }),
      delete: vi.fn().mockReturnValue(deleteChain),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deleteAccountByEmail(mockDb as any, 'existing@example.com');

    // delete should have been called once for each BA-owned table
    // (verification, twoFactor, sessions, accounts, users) = 5 times
    expect(mockDb.delete).toHaveBeenCalledTimes(5);
    expect(deleteChain.where).toHaveBeenCalledTimes(5);
  });
});
