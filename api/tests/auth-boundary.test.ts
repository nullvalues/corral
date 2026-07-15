import { describe, it, expect } from 'vitest';
import { getBoundary, BOUNDARY } from '../src/lib/auth-boundary.js';

describe('getBoundary', () => {
  it('throws for an unregistered resource type containing the resource name in the message', () => {
    expect(() => getBoundary('unregistered')).toThrowError('unregistered');
  });

  it('returns the correct model for a type added to BOUNDARY', () => {
    // Temporarily register a test resource type
    (BOUNDARY as Record<string, string>)['testResource'] = 'abac';
    try {
      expect(getBoundary('testResource')).toBe('abac');
    } finally {
      delete (BOUNDARY as Record<string, string>)['testResource'];
    }
  });

  it('throws with a message directing the developer to register in auth-boundary.ts', () => {
    expect(() => getBoundary('someOtherResource')).toThrowError(
      'api/src/lib/auth-boundary.ts',
    );
  });

  it('returns abac for experience', () => {
    expect(getBoundary('experience')).toBe('abac');
  });

  it('returns rbac for experienceCategory', () => {
    expect(getBoundary('experienceCategory')).toBe('rbac');
  });
});
