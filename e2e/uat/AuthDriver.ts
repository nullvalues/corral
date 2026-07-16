/**
 * AuthDriver — interface for UAT session setup helpers.
 *
 * Each role (applicant, admin, mentor) implements this interface to produce a
 * Playwright storageState file that subsequent tests can load via:
 *
 *   test.use({ storageState: driver.storageStatePath })
 *
 * Auth stack: Better Auth with TOTP (two-factor mandatory). Sessions are
 * stored as HttpOnly cookies; storageState captures cookies + localStorage
 * so that tests can restore a fully-authenticated browser context without
 * re-running the sign-in flow.
 *
 * Base URLs:
 *   App:  process.env['BASE_URL']  ?? 'http://localhost:6051'
 *   API:  process.env['API_BASE']  ?? 'http://localhost:6050'
 */

export interface AuthDriver {
  /**
   * Perform all steps required to establish an authenticated session for this
   * role and write the resulting Playwright storageState to `storageStatePath`.
   *
   * Implementations MUST be idempotent — calling setup() when a valid
   * storageState file already exists should be a no-op or re-use the existing
   * session. Tests share a single session per role to minimise setup overhead.
   *
   * @param email    Email address of the user to authenticate.
   * @param password Plain-text password of the user.
   */
  setup(email: string, password: string): Promise<void>;

  /**
   * Absolute path to the Playwright storageState JSON file written by setup().
   * Pass this value to `test.use({ storageState: driver.storageStatePath })`.
   */
  readonly storageStatePath: string;

  /**
   * Human-readable label for this driver (e.g. 'applicant', 'admin', 'mentor').
   * Used in log messages and error output.
   */
  readonly role: string;
}
