/**
 * Unit tests for insertAdminActionLog (API-025, updated API-035) and the
 * async-awaited audit wiring in the four admin write route handlers.
 *
 * Unit project — no DATABASE_URL_TEST required. Tests verify:
 *   insertAdminActionLog:
 *   - Does not throw when called with minimal opts (async)
 *   - Returns a Promise<void> (API-035: changed from fire-and-forget to async awaited)
 *   - Calls db.insert with the correct values
 *
 *   POST /api/mentor-grants:
 *   - Returns 201 and calls db.insert (audit log) after success
 *
 *   PATCH /api/mentor-grants/:id:
 *   - Returns 200 and calls db.insert (audit log) after success
 *   - Returns 404 when grant not found (db.insert not called for audit log)
 *
 *   POST /api/experience-categories:
 *   - Returns 201 and calls db.insert (audit log) after success
 *
 *   PATCH /api/experience-categories/:id:
 *   - Returns 200 and calls db.insert (audit log) after success
 *   - Returns 404 when category not found (db.insert not called for audit log)
 *
 * Wiring evidence: insertAdminActionLog calls await db.insert().values().
 * insertCallCount tracks how many times db.insert was called for audit purposes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before any imports.
// The insert chain must support two patterns:
//   db.insert().values().returning()   — createMentorGrant / createCategory
//   db.insert().values().catch()       — insertAdminActionLog (fire-and-forget)
// values() returns an object with both .returning() and .catch() methods.
// ---------------------------------------------------------------------------

const { limitMock, returningMock, updateReturningMock, orderByMock, insertMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  returningMock: vi.fn(),
  updateReturningMock: vi.fn(),
  orderByMock: vi.fn(),
  insertMock: vi.fn(),
}));

// insertMock tracks insert calls. insertAdminActionLog now awaits db.insert().values()
// so values() must be a thenable (Promise). createMentorGrant / createCategory use
// insert().values().returning() so we expose returning() on the values result as well.
vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: limitMock,
    orderBy: orderByMock,
    insert: insertMock.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        // thenable so `await db.insert().values()` resolves
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    }),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: updateReturningMock,
        }),
      }),
    })),
    delete: vi.fn().mockReturnThis(),
  },
}));

vi.mock('../src/services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
  setMailer: vi.fn(),
}));

import { insertAdminActionLog } from '../src/services/adminActionLog.js';
import { db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin-user-1';
const VALID_UUID = '00000000-0000-4000-8000-000000000001';

const FAKE_GRANT = {
  id: 'grant-uuid-1',
  mentorUserId: 'mentor-1',
  applicantUserId: 'applicant-2',
  permissions: ['read'],
  grantedByUserId: ADMIN_USER_ID,
  grantedAt: new Date('2026-01-01T00:00:00.000Z'),
  status: 'active',
};

const FAKE_CATEGORY = {
  id: VALID_UUID,
  slug: 'test-cat',
  name: 'Test Category',
  sortOrder: 0,
  isActive: true,
  goalHours: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function mockAdminSession() {
  const fakeUser = { id: ADMIN_USER_ID, name: 'Admin', email: 'admin@example.com', twoFactorEnabled: true };
  const fakeSession = { id: 'sess-admin', userId: ADMIN_USER_ID, token: 'tok-admin' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
  // Admin role grant found (consumed by requireRole preHandler's limitMock call)
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

// ---------------------------------------------------------------------------
// insertAdminActionLog unit tests
// ---------------------------------------------------------------------------

describe('insertAdminActionLog — unit', () => {
  it('does not throw when called with minimal opts (async)', async () => {
    await expect(
      insertAdminActionLog({
        actorUserId: 'user-1',
        action: 'grant_create',
        resourceType: 'mentor_grant',
        resourceId: 'grant-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('returns a Promise<void> (API-035: async awaited, no longer fire-and-forget)', async () => {
    const result = insertAdminActionLog({
      actorUserId: 'user-1',
      action: 'grant_create',
      resourceType: 'mentor_grant',
      resourceId: 'grant-1',
      after: { id: 'grant-1' },
    });
    expect(result).toBeInstanceOf(Promise);
    await result; // should resolve without error
  });

  it('calls db.insert with the correct values', async () => {
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValueOnce({ values: valuesMock } as unknown as ReturnType<typeof db.insert>);

    await insertAdminActionLog({
      actorUserId: 'actor-1',
      action: 'category_update',
      resourceType: 'experience_category',
      resourceId: 'cat-uuid-1',
      before: { id: 'cat-uuid-1', name: 'Old Name' },
      after: { id: 'cat-uuid-1', name: 'New Name' },
    });

    expect(valuesMock).toHaveBeenCalledWith({
      actorUserId: 'actor-1',
      action: 'category_update',
      resourceType: 'experience_category',
      resourceId: 'cat-uuid-1',
      before: { id: 'cat-uuid-1', name: 'Old Name' },
      after: { id: 'cat-uuid-1', name: 'New Name' },
    });
  });

  it('defaults before and after to null when not provided', async () => {
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValueOnce({ values: valuesMock } as unknown as ReturnType<typeof db.insert>);

    await insertAdminActionLog({
      actorUserId: 'actor-2',
      action: 'grant_create',
      resourceType: 'mentor_grant',
      resourceId: 'grant-2',
    });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ before: null, after: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/mentor-grants — audit log wiring
// ---------------------------------------------------------------------------

describe('POST /api/mentor-grants — audit log wiring (API-025)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    insertMock.mockReset().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    });
  });

  it('returns 201 and calls db.insert for insertAdminActionLog after successful grant creation', async () => {
    mockAdminSession();
    // getUserById(mentorUserId) + getUserById(applicantUserId) existence checks (API-052)
    limitMock.mockResolvedValueOnce([{ id: 'mentor-1', email: 'mentor@example.com' }]);
    limitMock.mockResolvedValueOnce([{ id: 'applicant-2', email: 'applicant@example.com' }]);
    // createMentorGrant uses insert().values().returning() — returns fake grant
    returningMock.mockResolvedValueOnce([FAKE_GRANT]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mentor-grants',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({
          mentorUserId: 'mentor-1',
          applicantUserId: 'applicant-2',
          permissions: ['read'],
        }),
      });
      expect(res.statusCode).toBe(201);
      // db.insert called twice: once for createMentorGrant, once for insertAdminActionLog
      expect(insertMock).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/mentor-grants/:id — audit log wiring
// ---------------------------------------------------------------------------

describe('PATCH /api/mentor-grants/:id — audit log wiring (API-025)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    insertMock.mockReset().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    });
  });

  it('returns 404 when getMentorGrantById returns null and does not fire audit log', async () => {
    mockAdminSession();
    // getMentorGrantById (select...limit) returns empty — 404 early exit
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/no-such-id',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'revoked' }),
      });
      expect(res.statusCode).toBe(404);
      // db.insert must NOT be called — audit log should not fire on 404
      expect(insertMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 200 and calls db.insert for insertAdminActionLog after successful grant update', async () => {
    mockAdminSession();
    // getMentorGrantById (select...limit) returns existing grant (before state)
    limitMock.mockResolvedValueOnce([FAKE_GRANT]);
    // updateMentorGrant returns updated grant
    updateReturningMock.mockResolvedValueOnce([{ ...FAKE_GRANT, status: 'revoked' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/mentor-grants/grant-uuid-1',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ status: 'revoked' }),
      });
      expect(res.statusCode).toBe(200);
      // db.insert called once for insertAdminActionLog (no insert for updateMentorGrant)
      expect(insertMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/experience-categories — audit log wiring
// ---------------------------------------------------------------------------

describe('POST /api/experience-categories — audit log wiring (API-025)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    insertMock.mockReset().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    });
  });

  it('returns 201 and calls db.insert for insertAdminActionLog after successful category creation', async () => {
    mockAdminSession();
    // createCategory uses insert().values().returning() — returns fake category
    returningMock.mockResolvedValueOnce([FAKE_CATEGORY]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/experience-categories',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ slug: 'test-cat', name: 'Test Category' }),
      });
      expect(res.statusCode).toBe(201);
      // db.insert called twice: once for createCategory, once for insertAdminActionLog
      expect(insertMock).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/experience-categories/:id — audit log wiring
// ---------------------------------------------------------------------------

describe('PATCH /api/experience-categories/:id — audit log wiring (API-025)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    insertMock.mockReset().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    });
  });

  it('returns 404 when getCategoryById returns null and does not fire audit log', async () => {
    mockAdminSession();
    // getCategoryById (select...limit) returns empty — 404 early exit
    limitMock.mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ name: 'New Name' }),
      });
      expect(res.statusCode).toBe(404);
      // db.insert must NOT be called — audit log should not fire on 404
      expect(insertMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 200 and calls db.insert for insertAdminActionLog after successful category update', async () => {
    mockAdminSession();
    // getCategoryById (select...limit) returns existing category (before state)
    limitMock.mockResolvedValueOnce([FAKE_CATEGORY]);
    // updateCategory returns updated category
    updateReturningMock.mockResolvedValueOnce([{ ...FAKE_CATEGORY, name: 'Updated Name' }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ name: 'Updated Name' }),
      });
      expect(res.statusCode).toBe(200);
      // db.insert called once for insertAdminActionLog (updateCategory uses update, not insert)
      expect(insertMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
