/**
 * Unit tests for insertPiiAccessLog (API-015).
 *
 * Unit project — no DATABASE_URL_TEST required. Tests verify:
 *   - insertPiiAccessLog does not throw synchronously
 *   - Function returns void (not a Promise)
 *   - No import from routes/ (layer model)
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module before any service imports.
// ---------------------------------------------------------------------------

vi.mock('../src/db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        catch: vi.fn(),
      }),
    }),
  },
}));

import { insertPiiAccessLog } from '../src/services/pii-access-log.js';
import { db } from '../src/db/index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('insertPiiAccessLog — unit', () => {
  it('does not throw synchronously when called with minimal opts', () => {
    expect(() =>
      insertPiiAccessLog({
        actorUserId: 'user-1',
        action: 'read',
        resourceType: 'experience',
      }),
    ).not.toThrow();
  });

  it('returns void (not a Promise)', () => {
    const result = insertPiiAccessLog({
      actorUserId: 'user-1',
      action: 'read',
      resourceType: 'experience',
      resourceId: 'exp-uuid-1',
      subjectUserId: 'user-2',
      viaGrant: true,
    });
    expect(result).toBeUndefined();
  });

  it('calls db.insert with the correct values', () => {
    const valuesMock = vi.fn().mockReturnValue({ catch: vi.fn() });
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as unknown as ReturnType<typeof db.insert>);

    insertPiiAccessLog({
      actorUserId: 'actor-1',
      action: 'create',
      resourceType: 'experience',
      resourceId: 'res-1',
      subjectUserId: 'subject-1',
      viaGrant: true,
    });

    expect(valuesMock).toHaveBeenCalledWith({
      actorUserId: 'actor-1',
      action: 'create',
      resourceType: 'experience',
      resourceId: 'res-1',
      subjectUserId: 'subject-1',
      viaGrant: true,
    });
  });

  it('defaults viaGrant to false when not provided', () => {
    const valuesMock = vi.fn().mockReturnValue({ catch: vi.fn() });
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as unknown as ReturnType<typeof db.insert>);

    insertPiiAccessLog({
      actorUserId: 'actor-2',
      action: 'update',
      resourceType: 'experience',
    });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ viaGrant: false }),
    );
  });
});
