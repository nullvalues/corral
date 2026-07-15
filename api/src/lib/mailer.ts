/**
 * MailerClient seam — INFRA-020.
 *
 * Defines the MailerClient interface, the ConsoleMailerAdapter (stdout-only,
 * used in development and test), and the createMailerClient factory that
 * selects the adapter based on config.MAILER_PROVIDER.
 *
 * Only lib/mailer.ts and lib/mailerAdapters/* may own email-sending concerns.
 * Consumers import MailerClient from here; they never import a concrete adapter
 * directly. Only lib/mailerAdapters/resend.ts may import the `resend` SDK.
 */

import type { Config } from './config.js';
import { ResendMailerAdapter } from './mailerAdapters/resend.js';
import { ConsoleMailerAdapter } from './mailerAdapters/console.js';

/** Options for sending a password-reset email. */
export interface MailerClientSendPasswordResetOpts {
  to: string;
  resetUrl: string;
}

/** Options for sending an experience-verified notification email. */
export interface MailerClientSendExperienceVerifiedOpts {
  to: string;
  experienceOrg: string;
  experiencePosition: string;
  verifierName: string;
}

/** Options for sending an experience-unverified notification email. */
export interface MailerClientSendExperienceUnverifiedOpts {
  to: string;
  experienceOrg: string;
  experiencePosition: string;
  verifierName: string;
}

/** Mailer seam — all email-sending goes through this interface. */
export interface MailerClient {
  sendPasswordReset(opts: MailerClientSendPasswordResetOpts): Promise<void>;
  sendExperienceVerified(opts: MailerClientSendExperienceVerifiedOpts): Promise<void>;
  sendExperienceUnverified(opts: MailerClientSendExperienceUnverifiedOpts): Promise<void>;
}

// Re-export ConsoleMailerAdapter so existing consumers that import it from
// lib/mailer.ts continue to resolve correctly (e.g. mailer.test.ts).
export { ConsoleMailerAdapter };

/**
 * Factory: selects the correct MailerClient implementation based on config.
 *
 * - MAILER_PROVIDER === 'console' → ConsoleMailerAdapter
 * - MAILER_PROVIDER === 'resend' → ResendMailerAdapter
 */
export function createMailerClient(config: Config): MailerClient {
  if (config.MAILER_PROVIDER === 'resend') {
    return new ResendMailerAdapter({
      resendApiKey: config.RESEND_API_KEY!,
      mailerFrom: config.MAILER_FROM!,
    });
  }
  return new ConsoleMailerAdapter();
}
