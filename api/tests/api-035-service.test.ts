/**
 * Unit tests for API-035 — setAdminRole service layer.
 *
 * Covers:
 *   - CER-026: throws 404 when target user does not exist
 *   - CER-027: insertAdminActionLog is awaited; before field set on revoke
 *   - Self-demotion still returns 403 after existence check (regression)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  insertAdminActionLogMock,
  dbSelectExistenceMock,
  dbTransactionMock,
  dbInsertMock,
} = vi.hoisted(() => ({
  insertAdminActionLogMock: vi.fn(),
  dbSelectExistenceMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  dbInsertMock: vi.fn(),
}));

vi.mock('../src/services/adminActionLog.js', () => ({
  insertAdminActionLog: insertAdminActionLogMock,
}));

// ---------------------------------------------------------------------------
// DB mock
//
// setAdminRole calls:
//   1. db.select({ id: users.id }).from(users).where(...) — existence check
//      → resolves to [{ id }] or []
//   2. (grant) db.insert(systemRoles).values(...).onConflictDoNothing()
//   3. (revoke) db.transaction(cb) — cb receives a tx
//
// RBAC guard is NOT used in service tests — we test setAdminRole directly.
// ---------------------------------------------------------------------------

vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() =>
      Promise.resolve(dbSelectExistenceMock()),
    ),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: dbInsertMock,
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    transaction: dbTransactionMock,
  },
}));

// We also need to mock auth so the module loads without real DB
vi.mock('../src/services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
  setMailer: vi.fn(),
}));

import { setAdminRole } from '../src/services/users.js';

const ACTOR_ID = 'actor-user-id';
const TARGET_ID = 'target-user-id';

beforeEach(() => {
  vi.clearAllMocks();
  insertAdminActionLogMock.mockResolvedValue(undefined);
  dbInsertMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// CER-026: existence check
// ---------------------------------------------------------------------------

describe('setAdminRole — CER-026 existence check', () => {
  it('throws 404 when target user does not exist', async () => {
    dbSelectExistenceMock.mockResolvedValueOnce([]); // no user

    let caught: Error & { statusCode?: number } | null = null;
    try {
      await setAdminRole(ACTOR_ID, TARGET_ID, 'grant');
    } catch (err) {
      caught = err as Error & { statusCode?: number };
    }

    expect(caught).not.toBeNull();
    expect(caught!.statusCode).toBe(404);
    expect(caught!.message).toBe('User not found');
  });

  it('does not throw 404 when target user exists', async () => {
    dbSelectExistenceMock.mockResolvedValueOnce([{ id: TARGET_ID }]);
    dbInsertMock.mockResolvedValue(undefined);

    // Should not throw 404 (may throw other things if tx not set up)
    let caught: Error & { statusCode?: number } | null = null;
    try {
      await setAdminRole(ACTOR_ID, TARGET_ID, 'grant');
    } catch (err) {
      caught = err as Error & { statusCode?: number };
    }

    if (caught) {
      expect(caught.statusCode).not.toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// Self-demotion regression
// ---------------------------------------------------------------------------

describe('setAdminRole — self-demotion regression', () => {
  it('throws 403 for self-demotion after existence check passes', async () => {
    dbSelectExistenceMock.mockResolvedValueOnce([{ id: ACTOR_ID }]); // user exists

    let caught: Error & { statusCode?: number } | null = null;
    try {
      await setAdminRole(ACTOR_ID, ACTOR_ID, 'revoke');
    } catch (err) {
      caught = err as Error & { statusCode?: number };
    }

    expect(caught).not.toBeNull();
    expect(caught!.statusCode).toBe(403);
    expect(caught!.message).toMatch(/own admin role/i);
  });
});

// ---------------------------------------------------------------------------
// CER-027: audit log before-state on revoke
// ---------------------------------------------------------------------------

describe('setAdminRole — CER-027 audit log', () => {
  it('grant: insertAdminActionLog called without before field', async () => {
    dbSelectExistenceMock.mockResolvedValueOnce([{ id: TARGET_ID }]);
    dbInsertMock.mockResolvedValue(undefined);

    await setAdminRole(ACTOR_ID, TARGET_ID, 'grant');

    expect(insertAdminActionLogMock).toHaveBeenCalledOnce();
    const args = insertAdminActionLogMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args.before).toBeUndefined();
    expect(args.after).toEqual({ role: 'admin', action: 'grant' });
  });

  it('revoke: insertAdminActionLog called with before: { role: "admin" }', async () => {
    dbSelectExistenceMock.mockResolvedValueOnce([{ id: TARGET_ID }]);

    // transaction mock: run callback with a tx that returns count=2, deletes fine
    dbTransactionMock.mockImplementation(
      async (cb: (tx: {
        select: () => { from: () => { where: () => Promise<Array<{ total: number }>> } };
        delete: () => { where: () => Promise<void> };
      }) => Promise<void>) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => Promise.resolve([{ total: 2 }]),
            }),
          }),
          delete: () => ({
            where: () => Promise.resolve(undefined),
          }),
        };
        return cb(tx);
      },
    );

    await setAdminRole(ACTOR_ID, TARGET_ID, 'revoke');

    expect(insertAdminActionLogMock).toHaveBeenCalledOnce();
    const args = insertAdminActionLogMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args.before).toEqual({ role: 'admin' });
    expect(args.after).toEqual({ role: 'admin', action: 'revoke' });
  });

  it('revoke: last-admin guard still throws 409 inside transaction', async () => {
    dbSelectExistenceMock.mockResolvedValueOnce([{ id: TARGET_ID }]);

    dbTransactionMock.mockImplementation(
      async (cb: (tx: {
        select: () => { from: () => { where: () => Promise<Array<{ total: number }>> } };
        delete: () => { where: () => Promise<void> };
      }) => Promise<void>) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => Promise.resolve([{ total: 1 }]), // only 1 admin
            }),
          }),
          delete: () => ({
            where: () => Promise.resolve(undefined),
          }),
        };
        return cb(tx);
      },
    );

    let caught: Error & { statusCode?: number } | null = null;
    try {
      await setAdminRole(ACTOR_ID, TARGET_ID, 'revoke');
    } catch (err) {
      caught = err as Error & { statusCode?: number };
    }

    expect(caught).not.toBeNull();
    expect(caught!.statusCode).toBe(409);
    expect(insertAdminActionLogMock).not.toHaveBeenCalled(); // no audit on guard failure
  });
});
