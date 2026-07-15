/**
 * Auth-coexistence boundary registry.
 *
 * ANY new resource type must be registered here before its first
 * RBAC- or ABAC-gated route story is written. Omitting a registration
 * is a HIGH reviewer finding.
 *
 * Governance model values:
 *   'rbac'  — access determined by user's system role only
 *   'abac'  — access determined by user's relationship to the resource
 *   'both'  — resource has both system-level and ownership-level controls
 */
type AuthModel = 'rbac' | 'abac' | 'both';

const BOUNDARY: Record<string, AuthModel> = {
  // Phase 5+ resource types registered here as they are introduced.
  experienceCategory: 'rbac',
  experience: 'abac',
};

export function getBoundary(resourceType: string): AuthModel {
  const model = BOUNDARY[resourceType];
  if (!model) {
    throw new Error(
      `Auth boundary not registered for resource type "${resourceType}". ` +
      `Register it in api/src/lib/auth-boundary.ts before writing a gated route.`,
    );
  }
  return model;
}

export { BOUNDARY };
