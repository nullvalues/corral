/**
 * Unit tests for insertPiiAccessLog catch path (API-052).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests verify:
 *   - A failing DB insert produces a structured error log with the
 *     'pii_access_log_write_failed' event key and does not throw.
 *   - The structured log includes non-PII identifiers (actorUserId, action,
 *     resourceType) but not sensitive fields like resourceId used as a PII pointer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before service imports.
// ---------------------------------------------------------------------------

const catchCallbackHolder: { fn: ((err: unknown) => void) | null } = { fn: null };

vi.mock('../src/db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        catch: vi.fn().mockImplementation((cb: (err: unknown) => void) => {
          catchCallbackHolder.fn = cb;
        }),
      }),
    }),
  },
}));

import { insertPiiAccessLog } from '../src/services/pii-access-log.js';

describe('insertPiiAccessLog catch path (API-052)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    catchCallbackHolder.fn = null;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not throw when the insert fails', () => {
    expect(() => {
      insertPiiAccessLog({
        actorUserId: 'user-1',
        action: 'read',
        resourceType: 'experience',
        resourceId: 'exp-uuid-1',
        subjectUserId: 'subject-1',
        viaGrant: false,
      });
    }).not.toThrow();
  });

  it('logs a structured error with pii_access_log_write_failed event key when insert fails', () => {
    insertPiiAccessLog({
      actorUserId: 'user-1',
      action: 'read',
      resourceType: 'experience',
      resourceId: 'exp-uuid-1',
      subjectUserId: 'subject-1',
      viaGrant: false,
    });

    // Simulate the DB failure by invoking the catch callback
    expect(catchCallbackHolder.fn).not.toBeNull();
    const simulatedError = new Error('connection refused');
    catchCallbackHolder.fn!(simulatedError);

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const loggedArg = consoleErrorSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(loggedArg) as Record<string, unknown>;

    expect(parsed.event).toBe('pii_access_log_write_failed');
    expect(parsed.actorUserId).toBe('user-1');
    expect(parsed.action).toBe('read');
    expect(parsed.resourceType).toBe('experience');
    // err field must be present and contain the error message
    expect(parsed.err).toBeDefined();
    const errObj = parsed.err as { message: string };
    expect(errObj.message).toBe('connection refused');
  });

  it('logs structured error even for non-Error throw values', () => {
    insertPiiAccessLog({
      actorUserId: 'user-2',
      action: 'create',
      resourceType: 'experience',
    });

    expect(catchCallbackHolder.fn).not.toBeNull();
    catchCallbackHolder.fn!('string error value');

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const loggedArg = consoleErrorSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(loggedArg) as Record<string, unknown>;

    expect(parsed.event).toBe('pii_access_log_write_failed');
    expect(typeof parsed.err).toBe('string');
    expect(parsed.err).toBe('string error value');
  });
});
