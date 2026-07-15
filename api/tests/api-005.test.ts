/**
 * Unit tests for GET /api/experience-categories (API-005).
 *
 * Unit project — no DATABASE_URL_TEST required. Only tests that do not
 * need a live DB belong here. The 401 unauthenticated test is the key
 * unit-level criterion.
 */

import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/experience-categories — unauthenticated (unit)', () => {
  it('returns 401 when no session cookie is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/experience-categories',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
