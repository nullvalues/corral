/**
 * Profile service — GET and PATCH /api/me/profile (API-047).
 *
 * Reads from BA-owned `users` table for name/email and from app-owned
 * `user_profiles` table for extended fields (school, graduationYear, bio,
 * major, gpa, phone, linkedinUrl, portfolioUrl — the last five added API-057).
 * PATCH upserts the user_profiles row and optionally updates users.name.
 *
 * No module-scope db import issue here (services/ may import db/ directly).
 */

import { db } from '../db/index.js';
import { users, userProfiles } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

export interface ProfileData {
  name: string;
  email: string;
  school: string | null;
  graduationYear: number | null;
  bio: string | null;
  major: string | null;
  gpa: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
}

export interface ProfilePatch {
  name?: string;
  school?: string | null;
  graduationYear?: number | null;
  bio?: string | null;
  major?: string | null;
  gpa?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
}

/**
 * Mentor-scoped applicant profile view (API-057). Deliberately excludes
 * `phone` (contact PII, gated elsewhere) and `gpa` (privacy-sensitive; not
 * surfaced to mentors). `name` comes from the applicant's user record.
 */
export interface MentorProfileView {
  name: string;
  school: string | null;
  graduationYear: number | null;
  bio: string | null;
  major: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
}

export async function getMyProfile(userId: string): Promise<ProfileData | null> {
  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));

  return {
    name: user.name,
    email: user.email,
    school: profile?.school ?? null,
    graduationYear: profile?.graduationYear ?? null,
    bio: profile?.bio ?? null,
    major: profile?.major ?? null,
    gpa: profile?.gpa ?? null,
    phone: profile?.phone ?? null,
    linkedinUrl: profile?.linkedinUrl ?? null,
    portfolioUrl: profile?.portfolioUrl ?? null,
  };
}

/**
 * Mentor-scoped read of an applicant's profile (API-057). Returns the
 * mentor-visible field subset — never `phone` or `gpa`. Returns null when the
 * applicant's user record does not exist. Access control (grant check) and the
 * PII audit write are the route's responsibility.
 */
export async function getApplicantProfileForMentor(
  applicantUserId: string,
): Promise<MentorProfileView | null> {
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, applicantUserId));
  if (!user) return null;

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, applicantUserId));

  return {
    name: user.name,
    school: profile?.school ?? null,
    graduationYear: profile?.graduationYear ?? null,
    bio: profile?.bio ?? null,
    major: profile?.major ?? null,
    linkedinUrl: profile?.linkedinUrl ?? null,
    portfolioUrl: profile?.portfolioUrl ?? null,
  };
}

/**
 * Read headshot_key and resume_key for a user.
 * Returns null if no user_profiles row exists for this user.
 */
export async function getProfileKeys(
  userId: string,
): Promise<{ headshotKey: string | null; resumeKey: string | null } | null> {
  const [profile] = await db
    .select({ headshotKey: userProfiles.headshotKey, resumeKey: userProfiles.resumeKey })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  // If no row, return defaults (null keys) rather than null
  return {
    headshotKey: profile?.headshotKey ?? null,
    resumeKey: profile?.resumeKey ?? null,
  };
}

/**
 * Update headshot_key or resume_key columns in user_profiles (API-065).
 * Upserts the row (creates if missing), sets only the provided key columns.
 */
export async function updateProfileKeys(
  userId: string,
  keys: { headshotKey?: string | null; resumeKey?: string | null },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (keys.headshotKey !== undefined) set['headshotKey'] = keys.headshotKey;
  if (keys.resumeKey !== undefined) set['resumeKey'] = keys.resumeKey;

  await db
    .insert(userProfiles)
    .values({
      userId,
      headshotKey: keys.headshotKey ?? null,
      resumeKey: keys.resumeKey ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set,
    });
}

export async function updateMyProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileData | null> {
  const { name, school, graduationYear, bio, major, gpa, phone, linkedinUrl, portfolioUrl } =
    patch;

  // Update BA users.name if provided
  if (name !== undefined) {
    await db.update(users).set({ name }).where(eq(users.id, userId));
  }

  // Upsert user_profiles for extended fields
  const hasExtended =
    school !== undefined ||
    graduationYear !== undefined ||
    bio !== undefined ||
    major !== undefined ||
    gpa !== undefined ||
    phone !== undefined ||
    linkedinUrl !== undefined ||
    portfolioUrl !== undefined;
  if (hasExtended) {
    await db
      .insert(userProfiles)
      .values({
        userId,
        school: school ?? null,
        graduationYear: graduationYear ?? null,
        bio: bio ?? null,
        major: major ?? null,
        gpa: gpa ?? null,
        phone: phone ?? null,
        linkedinUrl: linkedinUrl ?? null,
        portfolioUrl: portfolioUrl ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          ...(school !== undefined && { school }),
          ...(graduationYear !== undefined && { graduationYear }),
          ...(bio !== undefined && { bio }),
          ...(major !== undefined && { major }),
          ...(gpa !== undefined && { gpa }),
          ...(phone !== undefined && { phone }),
          ...(linkedinUrl !== undefined && { linkedinUrl }),
          ...(portfolioUrl !== undefined && { portfolioUrl }),
          updatedAt: new Date(),
        },
      });
  }

  return getMyProfile(userId);
}
