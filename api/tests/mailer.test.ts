import { describe, it, expect, vi } from 'vitest';
import {
  ConsoleMailerAdapter,
  createMailerClient,
} from '../src/lib/mailer.js';
import { ResendMailerAdapter } from '../src/lib/mailerAdapters/resend.js';
import type { Config } from '../src/lib/config.js';

/**
 * Minimal Config stub for factory tests. Uses satisfies to allow partial
 * overrides while keeping the required fields type-safe.
 */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    SESSION_SECRET: 'a'.repeat(64),
    ALLOWED_ORIGINS: 'http://localhost:6041',
    PORT: 6040,
    NODE_ENV: 'test',
    MFA_ENABLED: true,
    MFA_GRACE_HOURS: 24,
    DATABASE_URL: 'postgres://localhost/test',
    DATABASE_URL_TEST: undefined,
    STATIC_UI_ROOT: undefined,
    RATE_LIMIT_MAX: undefined,
    RATE_LIMIT_WINDOW_MS: undefined,
    MAILER_PROVIDER: 'console',
    MAILER_FROM: undefined,
    RESEND_API_KEY: undefined,
    ...overrides,
  } as Config;
}

describe('ConsoleMailerAdapter', () => {
  it('logs [mailer] sendPasswordReset with to and url to stdout', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const adapter = new ConsoleMailerAdapter();
      await adapter.sendPasswordReset({
        to: 'user@example.com',
        resetUrl: 'https://example.com/reset?token=abc123',
      });
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        '[mailer] sendPasswordReset to=user@example.com url=https://example.com/reset?token=abc123',
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('returns a resolved Promise', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const adapter = new ConsoleMailerAdapter();
      const result = adapter.sendPasswordReset({
        to: 'a@b.com',
        resetUrl: 'https://example.com/reset',
      });
      await expect(result).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createMailerClient', () => {
  it('returns ConsoleMailerAdapter when MAILER_PROVIDER is "console"', () => {
    const client = createMailerClient(makeConfig({ MAILER_PROVIDER: 'console' }));
    expect(client).toBeInstanceOf(ConsoleMailerAdapter);
  });

  it('returns ResendMailerAdapter when MAILER_PROVIDER is "resend"', () => {
    const client = createMailerClient(
      makeConfig({
        MAILER_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
        MAILER_FROM: 'noreply@example.com',
      }),
    );
    expect(client).toBeInstanceOf(ResendMailerAdapter);
  });
});
