/**
 * AUTH-007 — sendResetPassword callback wired through MailerClient seam.
 *
 * Verifies that:
 *  1. setMailer(mock) replaces the module-level _mailerClient.
 *  2. Invoking the sendResetPassword callback from buildAuthConfig(false)
 *     delegates to the injected mock with the correct arguments.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildAuthConfig, setMailer } from '../src/services/auth/index.js';
import type { MailerClient } from '../src/lib/mailer.js';
import { config } from '../src/lib/config.js';

describe('AUTH-007 — sendResetPassword wiring', () => {
  it('calls _mailerClient.sendPasswordReset with { to, resetUrl } from the BA callback', async () => {
    // Build a mock MailerClient that captures calls.
    const sendPasswordReset = vi.fn().mockResolvedValue(undefined);
    const mockMailer: MailerClient = {
      sendPasswordReset,
      sendExperienceVerified: vi.fn().mockResolvedValue(undefined),
      sendExperienceUnverified: vi.fn().mockResolvedValue(undefined),
    };

    // Inject the mock before using the callback.
    setMailer(mockMailer);

    // Retrieve the sendResetPassword handler from the config object.
    const authConfig = buildAuthConfig(false);
    const { sendResetPassword } = authConfig.emailAndPassword as {
      sendResetPassword: (args: { user: { email: string }; url: string }) => Promise<void>;
    };

    expect(sendResetPassword).toBeDefined();

    await sendResetPassword({ user: { email: 'x@example.com' }, url: 'https://example.com/reset?token=abc' });

    expect(sendPasswordReset).toHaveBeenCalledOnce();
    expect(sendPasswordReset).toHaveBeenCalledWith({
      to: 'x@example.com',
      resetUrl: 'https://example.com/reset?token=abc',
    });
  });

  it('does not call the mock when sendResetPassword is not invoked', () => {
    const sendPasswordReset = vi.fn().mockResolvedValue(undefined);
    const mockMailer: MailerClient = {
      sendPasswordReset,
      sendExperienceVerified: vi.fn().mockResolvedValue(undefined),
      sendExperienceUnverified: vi.fn().mockResolvedValue(undefined),
    };

    setMailer(mockMailer);

    // Just building the config should not trigger the callback.
    buildAuthConfig(false);

    expect(sendPasswordReset).not.toHaveBeenCalled();
  });
});

describe('INFRA-051 — session.expiresIn wired from SESSION_DURATION_HOURS', () => {
  it('session.expiresIn equals SESSION_DURATION_HOURS * 3600', () => {
    const authConfig = buildAuthConfig(false);
    const session = authConfig.session as { expiresIn?: number };
    expect(session.expiresIn).toBe(config.SESSION_DURATION_HOURS * 3600);
  });

  it('default SESSION_DURATION_HOURS (168) maps to 604800 seconds (7 days)', () => {
    const authConfig = buildAuthConfig(false);
    const session = authConfig.session as { expiresIn?: number };
    // Default is 168 hours = 7 days = 604800 seconds
    expect(session.expiresIn).toBe(604800);
  });
});
