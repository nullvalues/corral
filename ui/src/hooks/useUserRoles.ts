import { useMe } from './useMe.js';

export interface UserRoles {
  isAdmin: boolean;
  isApplicant: boolean;
  isLoading: boolean;
  isReady: boolean;
}

/**
 * Centralizes role derivation from `useMe()` so callers don't each
 * independently compute `roles.includes('admin')`.
 */
export function useUserRoles(): UserRoles {
  const { data, isLoading } = useMe();
  const roles = data?.roles ?? [];

  return {
    isAdmin: roles.includes('admin'),
    isApplicant: roles.includes('applicant'),
    isLoading,
    isReady: !isLoading && data !== undefined,
  };
}
