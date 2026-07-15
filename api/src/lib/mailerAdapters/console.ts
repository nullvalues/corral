/**
 * ConsoleMailerAdapter — logs to stdout; no network I/O.
 * Used when MAILER_PROVIDER is 'console' or undefined (development and UAT).
 *
 * UAT-005: Maintains an in-process ring buffer of the last BUFFER_MAX reset
 * links sent, so the `GET /api/uat/reset-links` endpoint can surface them to
 * a test harness without requiring log scraping or a live email inbox.
 *
 * The buffer is module-level state — one instance per Node.js process. It is
 * only populated when the console adapter is actively used.
 */

import type {
  MailerClient,
  MailerClientSendPasswordResetOpts,
  MailerClientSendExperienceVerifiedOpts,
  MailerClientSendExperienceUnverifiedOpts,
} from '../mailer.js';

export interface ResetLinkEntry {
  email: string;
  url: string;
  sentAt: string;
}

const RESET_LINK_BUFFER: ResetLinkEntry[] = [];
const BUFFER_MAX = 10;

/**
 * Returns a shallow copy of the current reset-link buffer.
 * Called by `GET /api/uat/reset-links` (UAT-env-gated).
 */
export function getResetLinks(): ResetLinkEntry[] {
  return [...RESET_LINK_BUFFER];
}

/**
 * Clears the buffer. Exposed for test isolation — call between test cases to
 * prevent cross-test bleed.
 */
export function clearResetLinks(): void {
  RESET_LINK_BUFFER.splice(0);
}

export class ConsoleMailerAdapter implements MailerClient {
  sendPasswordReset(opts: MailerClientSendPasswordResetOpts): Promise<void> {
    console.log(`[mailer] sendPasswordReset to=${opts.to} url=${opts.resetUrl}`);

    // Push to ring buffer; shift oldest when capacity exceeded.
    RESET_LINK_BUFFER.push({
      email: opts.to,
      url: opts.resetUrl,
      sentAt: new Date().toISOString(),
    });
    if (RESET_LINK_BUFFER.length > BUFFER_MAX) {
      RESET_LINK_BUFFER.shift();
    }

    return Promise.resolve();
  }

  sendExperienceVerified(opts: MailerClientSendExperienceVerifiedOpts): Promise<void> {
    console.log(
      `[mailer] sendExperienceVerified to=${opts.to} org=${opts.experienceOrg} position=${opts.experiencePosition} verifier=${opts.verifierName}`,
    );
    return Promise.resolve();
  }

  sendExperienceUnverified(opts: MailerClientSendExperienceUnverifiedOpts): Promise<void> {
    console.log(
      `[mailer] sendExperienceUnverified to=${opts.to} org=${opts.experienceOrg} position=${opts.experiencePosition} verifier=${opts.verifierName}`,
    );
    return Promise.resolve();
  }
}
