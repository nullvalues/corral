/**
 * ResendMailerAdapter — production email adapter using the Resend SDK.
 *
 * INFRA-023. Only this file may import the `resend` SDK (enforced by
 * ESLint `no-restricted-imports` on routes/, services/, agents/).
 *
 * PII policy: `to` (recipient email) must NOT appear in error or warn logs.
 * Success logs include only the Resend message id.
 */

import { Resend } from 'resend';
import type {
  MailerClient,
  MailerClientSendPasswordResetOpts,
  MailerClientSendExperienceVerifiedOpts,
  MailerClientSendExperienceUnverifiedOpts,
} from '../mailer.js';

export class ResendMailerAdapter implements MailerClient {
  private readonly resend: Resend;
  private readonly config: { resendApiKey: string; mailerFrom: string };

  constructor(config: { resendApiKey: string; mailerFrom: string }) {
    this.config = config;
    this.resend = new Resend(config.resendApiKey);
  }

  async sendPasswordReset({ to, resetUrl }: MailerClientSendPasswordResetOpts): Promise<void> {
    try {
      const result = await Promise.race([
        this.resend.emails.send({
          from: this.config.mailerFrom,
          to,
          subject: 'Reset your password',
          text: resetUrl,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Email send timeout')), 10_000),
        ),
      ]);
      console.info('[mailer] sendPasswordReset sent', { id: result.data?.id });
    } catch (err) {
      console.error('[mailer] sendPasswordReset failed', {
        error: (err as Error).message,
      });
      throw err;
    }
  }

  async sendExperienceVerified({
    to,
    experienceOrg,
    experiencePosition,
    verifierName,
  }: MailerClientSendExperienceVerifiedOpts): Promise<void> {
    try {
      const result = await Promise.race([
        this.resend.emails.send({
          from: this.config.mailerFrom,
          to,
          subject: 'Your experience has been verified',
          text: `Your experience "${experiencePosition}" at ${experienceOrg} has been verified by ${verifierName}.`,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Email send timeout')), 10_000),
        ),
      ]);
      console.info('[mailer] sendExperienceVerified sent', { id: result.data?.id });
    } catch (err) {
      console.error('[mailer] sendExperienceVerified failed', {
        error: (err as Error).message,
      });
      throw err;
    }
  }

  async sendExperienceUnverified({
    to,
    experienceOrg,
    experiencePosition,
    verifierName,
  }: MailerClientSendExperienceUnverifiedOpts): Promise<void> {
    try {
      const result = await Promise.race([
        this.resend.emails.send({
          from: this.config.mailerFrom,
          to,
          subject: 'Experience verification removed',
          text: `The verification for your experience "${experiencePosition}" at ${experienceOrg} has been removed by ${verifierName}.`,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Email send timeout')), 10_000),
        ),
      ]);
      console.info('[mailer] sendExperienceUnverified sent', { id: result.data?.id });
    } catch (err) {
      console.error('[mailer] sendExperienceUnverified failed', {
        error: (err as Error).message,
      });
      throw err;
    }
  }
}
