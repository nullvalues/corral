import { describe, it, expect } from 'vitest';
import { ErrorSchema } from '../src/routes/shared-schemas.js';

describe('shared-schemas ErrorSchema (API-053)', () => {
  it('parses a valid error envelope', () => {
    expect(ErrorSchema.parse({ error: 'x' })).toEqual({ error: 'x' });
  });

  it('rejects an empty object (missing error field)', () => {
    expect(ErrorSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string error field', () => {
    expect(ErrorSchema.safeParse({ error: 42 }).success).toBe(false);
  });
});
