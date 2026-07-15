/**
 * DB-025 test: readiness_config schema unit tests.
 *
 * Unit tests verify:
 *   - readinessConfig is exported from the readiness schema
 *   - It exposes the expected keys: id, wGoal, wVerified, wBreadth
 */

import { describe, it, expect } from 'vitest';
import * as readinessSchema from '../src/db/schema/readiness.js';

describe('DB-025: readinessConfig schema (unit)', () => {
  it('readinessConfig is exported from readiness schema', () => {
    expect(readinessSchema.readinessConfig).toBeDefined();
  });

  it('readinessConfig has id key', () => {
    expect(Object.keys(readinessSchema.readinessConfig)).toContain('id');
  });

  it('readinessConfig has wGoal key', () => {
    expect(Object.keys(readinessSchema.readinessConfig)).toContain('wGoal');
  });

  it('readinessConfig has wVerified key', () => {
    expect(Object.keys(readinessSchema.readinessConfig)).toContain('wVerified');
  });

  it('readinessConfig has wBreadth key', () => {
    expect(Object.keys(readinessSchema.readinessConfig)).toContain('wBreadth');
  });
});
