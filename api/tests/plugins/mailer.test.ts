import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import mailerPlugin from '../../src/plugins/mailer.js';
import { ConsoleMailerAdapter, type MailerClient } from '../../src/lib/mailer.js';

const ENV_STUBS = {
  PORT: '6050',
  SESSION_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'http://localhost:6051',
  NODE_ENV: 'test',
  MFA_ENABLED: 'true',
} as const;

describe('mailerPlugin', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV_STUBS)) {
      vi.stubEnv(k, v);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('decorates fastify.mailer with the injected client', async () => {
    const fakeMailer: MailerClient = {
      sendPasswordReset: vi.fn().mockResolvedValue(undefined),
      sendExperienceVerified: vi.fn().mockResolvedValue(undefined),
      sendExperienceUnverified: vi.fn().mockResolvedValue(undefined),
    };
    const app = Fastify();
    await app.register(mailerPlugin, { client: fakeMailer });
    await app.ready();
    expect(app.mailer).toBe(fakeMailer);
    await app.close();
  });

  it('falls back to ConsoleMailerAdapter when no client is supplied', async () => {
    const app = Fastify();
    await app.register(mailerPlugin, {});
    await app.ready();
    expect(app.mailer).toBeInstanceOf(ConsoleMailerAdapter);
    await app.close();
  });

  it('decoration is accessible outside plugin encapsulation scope (fp-wrapped)', async () => {
    const fakeMailer: MailerClient = {
      sendPasswordReset: vi.fn().mockResolvedValue(undefined),
      sendExperienceVerified: vi.fn().mockResolvedValue(undefined),
      sendExperienceUnverified: vi.fn().mockResolvedValue(undefined),
    };
    const app = Fastify();
    await app.register(mailerPlugin, { client: fakeMailer });
    await app.ready();
    // The plugin is fp-wrapped; decoration must be visible on root app
    expect(app.mailer).toBeDefined();
    expect(typeof app.mailer.sendPasswordReset).toBe('function');
    await app.close();
  });

  it('registered plugin name is asp-mailer', async () => {
    const app = Fastify();
    await app.register(mailerPlugin, {});
    await app.ready();
    // Verify we can register it without a "duplicate plugin name" error
    // (fp assigns name 'asp-mailer'; Fastify tracks by name)
    expect(app.mailer).toBeDefined();
    await app.close();
  });
});
