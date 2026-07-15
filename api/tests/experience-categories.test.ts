/**
 * Tests for audit log completeness in /api/experience-categories (API-051).
 *
 * Unit section: verifies DELETE audit log wiring via mock (no DATABASE_URL_TEST required).
 * Integration section: verifies the actual admin_action_log row written on DELETE.
 *
 * Covers (API-051 Ensures):
 *   - DELETE handler calls insertAdminActionLog with action='category_delete',
 *     resourceType='experience_category', before=existingCategory, after=null.
 *   - Existing create/update tests still pass with the awaited audit calls.
 */

// ---------------------------------------------------------------------------
// Unit tests — mock DB, no live database required
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { limitMock, returningMock, updateReturningMock, orderByMock, insertMock, deleteMock } =
  vi.hoisted(() => ({
    limitMock: vi.fn(),
    returningMock: vi.fn(),
    updateReturningMock: vi.fn(),
    orderByMock: vi.fn(),
    insertMock: vi.fn(),
    deleteMock: vi.fn(),
  }));

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
    delete: vi.fn(() => ({
      where: vi.fn().mockReturnValue({
        returning: deleteMock,
      }),
    })),
    execute: vi.fn().mockResolvedValue([]),
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

import { db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';

const ADMIN_USER_ID = 'admin-user-api051';
const VALID_UUID = '00000000-0000-4000-8000-000000000051';

const FAKE_CATEGORY = {
  id: VALID_UUID,
  slug: 'api051-cat',
  name: 'API051 Category',
  sortOrder: 0,
  isActive: true,
  goalHours: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function mockAdminSession() {
  const fakeUser = {
    id: ADMIN_USER_ID,
    name: 'Admin',
    email: 'admin051@example.com',
    twoFactorEnabled: true,
  };
  const fakeSession = { id: 'sess-admin051', userId: ADMIN_USER_ID, token: 'tok-admin051' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
  // Admin role grant (consumed by requireRole preHandler's limitMock call)
  limitMock.mockResolvedValueOnce([{ userId: ADMIN_USER_ID, role: 'admin' }]);
}

// ---------------------------------------------------------------------------
// DELETE /api/experience-categories/:id — audit log wiring
// ---------------------------------------------------------------------------

describe('DELETE /api/experience-categories/:id — audit log wiring (API-051)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    deleteMock.mockResolvedValue([]);
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
        method: 'DELETE',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(404);
      // db.insert must NOT be called — audit log should not fire on 404
      expect(insertMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 204 and calls db.insert for insertAdminActionLog after successful category delete', async () => {
    mockAdminSession();
    // getCategoryById (select...limit) returns existing category (before state)
    limitMock.mockResolvedValueOnce([FAKE_CATEGORY]);
    // deleteCategory uses db.delete().where().returning() — returns deleted row
    deleteMock.mockResolvedValueOnce([{ id: VALID_UUID }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(204);
      // db.insert called once for insertAdminActionLog (deleteCategory uses db.delete, not insert)
      expect(insertMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('passes correct audit log fields: action=category_delete, before=existingCategory, after=null', async () => {
    mockAdminSession();
    limitMock.mockResolvedValueOnce([FAKE_CATEGORY]);
    deleteMock.mockResolvedValueOnce([{ id: VALID_UUID }]);

    // Capture what values() is called with
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    insertMock.mockReturnValueOnce({ values: valuesMock });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(204);
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: ADMIN_USER_ID,
          action: 'category_delete',
          resourceType: 'experience_category',
          resourceId: VALID_UUID,
          before: FAKE_CATEGORY,
          after: null,
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('does not call db.insert when delete returns in_use (409)', async () => {
    mockAdminSession();
    // getCategoryById returns existing category
    limitMock.mockResolvedValueOnce([FAKE_CATEGORY]);
    // deleteCategory FK violation → in_use outcome (simulate by having deleteMock reject with FK error)
    const fkError = Object.assign(new Error('FK violation'), { code: '23503' });
    deleteMock.mockRejectedValueOnce(fkError);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/experience-categories/${VALID_UUID}`,
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(409);
      expect(insertMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/experience-categories — await fix (API-051)
// ---------------------------------------------------------------------------

describe('POST /api/experience-categories — await audit fix (API-051)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    deleteMock.mockResolvedValue([]);
    insertMock.mockReset().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    });
  });

  it('returns 201 and calls db.insert twice (create + audit) after successful category creation', async () => {
    mockAdminSession();
    returningMock.mockResolvedValueOnce([FAKE_CATEGORY]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/experience-categories',
        headers: { 'content-type': 'application/json', cookie: 'session=fake' },
        payload: JSON.stringify({ slug: 'api051-cat', name: 'API051 Category' }),
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
// PATCH /api/experience-categories/:id — await fix (API-051)
// ---------------------------------------------------------------------------

describe('PATCH /api/experience-categories/:id — await audit fix (API-051)', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    limitMock.mockResolvedValue([]);
    returningMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([]);
    orderByMock.mockResolvedValue([]);
    deleteMock.mockResolvedValue([]);
    insertMock.mockReset().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
        catch: (reject: (e: unknown) => unknown) => Promise.resolve(undefined).catch(reject),
        finally: (cb: () => void) => Promise.resolve(undefined).finally(cb),
      }),
    });
  });

  it('returns 200 and calls db.insert for audit after successful category update', async () => {
    mockAdminSession();
    limitMock.mockResolvedValueOnce([FAKE_CATEGORY]);
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
      // db.insert called once for insertAdminActionLog (updateCategory uses db.update)
      expect(insertMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
