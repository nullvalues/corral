/**
 * API-030 — PATCH /api/users/:id/roles
 * Request and response types for the admin role promote/demote endpoint.
 */

/** Request body for PATCH /api/users/:id/roles */
export interface SetAdminRoleBody {
  role: 'admin';
  action: 'grant' | 'revoke';
}

/** Response body for a successful PATCH /api/users/:id/roles */
export interface SetAdminRoleResponse {
  userId: string;
  roles: string[];
}

/**
 * API-032 — GET /api/mentor-grants (enriched list)
 * The admin grant list response joins applicant and mentor user info.
 */

/** A single grant row returned by GET /api/mentor-grants (with applicant and mentor name+email joined in) */
export interface MentorGrantListItem {
  id: string;
  mentorUserId: string;
  applicantUserId: string;
  permissions: string[];
  grantedByUserId: string;
  grantedAt: string; // ISO timestamp
  status: string;
  requestedByUserId?: string | null;
  applicantName: string;
  applicantEmail: string;
  mentorName: string;
  mentorEmail: string;
}

/**
 * API-031 — POST /api/mentor-grants/requests
 * Request and response types for applicant-initiated mentor requests.
 */

/** Request body for POST /api/mentor-grants/requests */
export interface RequestMentorGrantBody {
  mentorEmail: string;
}

/** Response body for a successful POST /api/mentor-grants/requests (201) */
export interface RequestMentorGrantResponse {
  id: string;
  mentorUserId: string;
  applicantUserId: string;
  permissions: string[];
  grantedByUserId: string;
  grantedAt: string; // ISO timestamp
  status: 'pending';
  requestedByUserId: string;
}

/**
 * API-033 — PATCH /api/experiences/:id/verification
 * Request body for the mentor verify / un-verify endpoint.
 */

/** Request body for PATCH /api/experiences/:id/verification */
export interface VerifyExperienceBody {
  action: 'verify' | 'unverify';
}
