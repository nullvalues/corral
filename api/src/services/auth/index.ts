import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { db } from '../../db/index.js';
import {
  users,
  sessions,
  accounts,
  verification,
  twoFactor as twoFactorTable,
  systemRoles,
} from '../../db/schema/index.js';
import { config } from '../../lib/config.js';
import { type MailerClient, createMailerClient } from '../../lib/mailer.js';

/**
 * Module-level mailer instance. Defaults to the factory default (driven by
 * config.MAILER_PROVIDER). Replaced at startup by `setMailer(app.mailer)` in
 * app.ts after the mailerPlugin is registered, so the production instance uses
 * whatever adapter buildApp() was given. In tests, call setMailer(mock) before
 * invoking the sendResetPassword callback.
 */
let _mailerClient: MailerClient = createMailerClient(config);

/**
 * Replace the module-level mailer client. Called by app.ts after
 * `await app.register(mailerPlugin, ...)` so the decorated `app.mailer`
 * instance is the one used for all reset-password emails.
 */
export function setMailer(m: MailerClient): void {
  _mailerClient = m;
}

/**
 * Build the Better Auth options object.
 *
 * Extracted as a function so that the production/non-production cookie
 * security behaviour can be exercised in unit tests without mutating
 * NODE_ENV (which is frozen at module-load time by config.ts).
 */
export function buildAuthConfig(isProduction: boolean, allowedOrigins: string[] = []) {
  return {
    trustedOrigins: allowedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg' as const,
      // BA model names (singular) → our Drizzle table objects (plural exports).
      // Required because db is initialised without a schema object (db/index.ts
      // calls drizzle(pool) with no schema arg), so db._.fullSchema is empty
      // and the adapter cannot auto-discover tables. See ADR-010.
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification,
        twoFactor: twoFactorTable,
      },
    }),
    user: {
      // API-060: enable the BA built-in delete-user endpoint.
      // Without this option, POST /api/auth/delete-user returns 404.
      deleteUser: {
        enabled: true,
      },
    },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        await _mailerClient.sendPasswordReset({ to: user.email, resetUrl: url });
      },
    },
    // Session storage: drizzleAdapter causes BA to persist sessions in
    // PostgreSQL by default. Stated explicitly here to make intent clear.
    // expiresIn is in seconds; SESSION_DURATION_HOURS defaults to 168 (7 days),
    // matching the Better Auth built-in default.
    session: {
      expiresIn: config.SESSION_DURATION_HOURS * 3600,
    },
    advanced: {
      // SameSite=Lax chosen over Strict — see docs/ideology.md.
      cookies: {
        sessionToken: {
          attributes: {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax' as const,
          },
        },
      },
    },
    plugins: [
      // AUTH-003: TOTP-only 2FA. issuer shown in authenticator apps.
      // allowPasswordless: true enables passwordless-signup users to enable 2FA
      // without a password. Email+password users must still supply their password
      // when calling two-factor/enable (BA's shouldRequirePassword returns true
      // when a credential account with a password exists).
      twoFactor({ issuer: 'asp', allowPasswordless: true }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string }) => {
            await db
              .insert(systemRoles)
              .values({ userId: user.id, role: 'applicant' })
              .onConflictDoNothing();
          },
        },
      },
    },
  };
}

export const auth = betterAuth(buildAuthConfig(config.NODE_ENV === 'production', config.ALLOWED_ORIGINS));
