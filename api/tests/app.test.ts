import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { NotImplementedError } from '../src/lib/errors.js';
import type { StorageClient } from '../src/lib/storage.js';
import type { AiClient } from '../src/lib/ai.js';

/**
 * Pre-stub every env var that real config gates (INFRA-004) will demand at
 * import time. Today the stub `config.ts` only reads `PORT`, but stubbing the
 * full set here means INFRA-004 can wire the real gates without us having to
 * revisit this test.
 *
 * A deliberate `process.env.FOO` write also serves as a live check that the
 * eslint `no-process-env` rule is correctly disabled for test files
 * matching the `*.test.ts` glob (acceptance criterion in INFRA-002).
 */
const ENV_STUBS = {
  PORT: '6050',
  SESSION_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'http://localhost:6051',
  NODE_ENV: 'test',
  MFA_ENABLED: 'true',
  FOO: 'eslint-rule-exemption-canary',
} as const;

describe('buildApp', () => {
  let netSpy: ReturnType<typeof vi.spyOn>;
  let fsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV_STUBS)) {
      vi.stubEnv(k, v);
    }
    // Spy on net + fs side-effect surfaces so we can assert nothing was called
    // during construction.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require('node:net');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    netSpy = vi.spyOn(net, 'createConnection');
    fsSpy = vi.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns a Fastify instance', async () => {
    // Deliberate process.env read — proves the eslint no-process-env rule is
    // DISABLED for test files (INFRA-002 acceptance criterion). If the
    // override breaks, lint will flag this line.
    expect(process.env.FOO).toBe('eslint-rule-exemption-canary');

    const app = await buildApp();
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
    expect(typeof app.close).toBe('function');
    expect(typeof app.register).toBe('function');
    await app.close();
  });

  it('performs no I/O during construction', async () => {
    const app = await buildApp();
    // No outgoing connection should have been opened.
    expect(netSpy).not.toHaveBeenCalled();
    // No filesystem read should have happened.
    expect(fsSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts injected storage and ai clients without invoking them', async () => {
    const storageClient: StorageClient = {
      upload: vi.fn(),
      download: vi.fn(),
      getSignedUrl: vi.fn(),
      delete: vi.fn(),
    };
    const aiClient: AiClient = { complete: vi.fn() };
    const app = await buildApp({ storageClient, aiClient });
    expect(storageClient.upload).not.toHaveBeenCalled();
    expect(storageClient.download).not.toHaveBeenCalled();
    expect(storageClient.getSignedUrl).not.toHaveBeenCalled();
    expect(storageClient.delete).not.toHaveBeenCalled();
    expect(aiClient.complete).not.toHaveBeenCalled();
    await app.close();
  });

  it('decorates the instance with the S3-backed storageClient when none is injected', async () => {
    // INFRA-054: the default factory now returns a real S3-backed client
    // (not a NotImplementedError stub). Methods exist and are callable;
    // without S3_BUCKET configured they throw a config error, not NotImplementedError.
    const app = await buildApp();
    expect(app.storageClient).toBeDefined();
    expect(typeof app.storageClient.upload).toBe('function');
    expect(typeof app.storageClient.download).toBe('function');
    expect(typeof app.storageClient.getSignedUrl).toBe('function');
    expect(typeof app.storageClient.delete).toBe('function');
    await app.close();
  });

  it('decorates the instance with the default stub aiClient when none is injected', async () => {
    const app = await buildApp();
    expect(app.aiClient).toBeDefined();
    expect(typeof app.aiClient.complete).toBe('function');
    await expect(
      app.aiClient.complete({ prompt: 'hi' }),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await app.close();
  });

  it('exposes the injected storageClient as fastify.storageClient', async () => {
    const storageClient: StorageClient = {
      upload: vi.fn(),
      download: vi.fn(),
      getSignedUrl: vi.fn(),
      delete: vi.fn(),
    };
    const app = await buildApp({ storageClient });
    expect(app.storageClient).toBe(storageClient);
    await app.close();
  });

  it('exposes the injected aiClient as fastify.aiClient', async () => {
    const aiClient: AiClient = { complete: vi.fn() };
    const app = await buildApp({ aiClient });
    expect(app.aiClient).toBe(aiClient);
    await app.close();
  });
});
