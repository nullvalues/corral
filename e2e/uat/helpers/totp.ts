/**
 * TOTP code generation helper for UAT session drivers.
 *
 * Uses the same `otplib` library used by e2e/fixtures/applicantSession.ts.
 */
import { generateSync } from 'otplib';

/**
 * Generate a current TOTP code from a base32-encoded secret.
 *
 * @param secret  Base32-encoded TOTP secret (parsed from an otpauth:// URI).
 * @returns       6-digit TOTP code as a string.
 */
export function generateTotpCode(secret: string): string {
  return generateSync({ secret });
}
