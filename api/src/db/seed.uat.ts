/**
 * UAT seed script — stable test accounts for user acceptance testing.
 *
 * Provisions three accounts (applicant, mentor, admin), a mentor grant
 * linking mentor → applicant, and one sample experience with all contact PII
 * fields populated and permissionToContact=false.
 *
 * Idempotent (delete-and-recreate): deletes all three UAT accounts and all
 * associated app-owned rows (experiences, system_roles, mentor_grants) before
 * recreating them.  Every run produces the same known-clean state — no leftover
 * sessions, no enrolled TOTP factors, no stale verification records.
 *
 * Approved direct process.env reader — this is a standalone CLI script that
 * runs outside the Fastify process (same pattern as src/scripts/seed.prod.ts).
 * See docs/architecture.md § Layer rules.
 *
 * Usage: pnpm seed:uat
 * Requires: DATABASE_URL, API_BASE (e.g. http://localhost:6050)
 */

import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { users } from './schema/auth.js';
import { systemRoles, mentorGrants } from './schema/roles.js';
import { experiences, experienceCategories } from './schema/experiences.js';
import { deleteAccountByEmail, ensureAccount, enrollTotp, writeUatSecrets } from './seed-uat-helpers.js';
import { CATEGORIES } from './seed.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UAT_APPLICANT = { email: 'uat-applicant@asp.dev', password: 'UatApplicant1!' };
const UAT_MENTOR = { email: 'uat-mentor@asp.dev', password: 'UatMentor1!' };
const UAT_ADMIN = { email: 'uat-admin@asp.dev', password: 'UatAdmin1!' };

const UAT_ACCOUNTS = [UAT_APPLICANT, UAT_MENTOR, UAT_ADMIN] as const;

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:6050';
const ORIGIN = API_BASE;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const client = postgres(DATABASE_URL, { max: 1 });

try {
  const db = drizzle(client);

  console.log('seed:uat — starting');

  // -------------------------------------------------------------------------
  // 0. Delete all app-owned rows that reference existing UAT user ids.
  //    We resolve any existing user ids first, then delete app-owned rows in
  //    the correct order before the BA-owned rows are removed in step 1.
  // -------------------------------------------------------------------------

  const uatEmails = UAT_ACCOUNTS.map((a) => a.email);

  const existingUserRows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [...uatEmails]));

  const existingIds = existingUserRows.map((u) => u.id);

  if (existingIds.length > 0) {
    await db.delete(experiences).where(inArray(experiences.ownerUserId, existingIds));
    await db.delete(systemRoles).where(inArray(systemRoles.userId, existingIds));
    // mentor_grants references UAT users in three columns — cover all three.
    await db.delete(mentorGrants).where(inArray(mentorGrants.mentorUserId, existingIds));
    await db.delete(mentorGrants).where(inArray(mentorGrants.applicantUserId, existingIds));
    await db.delete(mentorGrants).where(inArray(mentorGrants.grantedByUserId, existingIds));
    console.log(`  cleaned app-owned rows for ${existingIds.length} existing UAT user(s)`);
  }

  // -------------------------------------------------------------------------
  // 1. Delete all three UAT accounts (BA-owned tables) then recreate them.
  // -------------------------------------------------------------------------

  for (const acct of UAT_ACCOUNTS) {
    await deleteAccountByEmail(db, acct.email);
    console.log(`  deleted BA records for ${acct.email} (no-op if absent)`);
  }

  const ids: Record<string, string> = {};
  for (const acct of UAT_ACCOUNTS) {
    const id = await ensureAccount(acct.email, acct.password, API_BASE, ORIGIN);
    ids[acct.email] = id;
    console.log(`  account ${acct.email} → ${id}`);
  }

  // -------------------------------------------------------------------------
  // 1b. Enrol TOTP for all three accounts and write secrets sidecar
  // -------------------------------------------------------------------------

  const totpSecrets: Record<string, string> = {};
  for (const acct of UAT_ACCOUNTS) {
    const secret = await enrollTotp(acct.email, acct.password, API_BASE, ORIGIN);
    totpSecrets[acct.email] = secret;
    console.log(`  TOTP enrolled for ${acct.email}`);
  }

  writeUatSecrets({
    applicant: { email: UAT_APPLICANT.email, totpSecret: totpSecrets[UAT_APPLICANT.email]! },
    mentor: { email: UAT_MENTOR.email, totpSecret: totpSecrets[UAT_MENTOR.email]! },
    admin: { email: UAT_ADMIN.email, totpSecret: totpSecrets[UAT_ADMIN.email]! },
  });
  console.log('  UAT secrets sidecar written to e2e/uat/.uat-secrets.json');
  console.log('  TOTP secrets — add to your authenticator app:');
  console.log(`    applicant  ${UAT_APPLICANT.email}  ${totpSecrets[UAT_APPLICANT.email]}`);
  console.log(`    mentor     ${UAT_MENTOR.email}     ${totpSecrets[UAT_MENTOR.email]}`);
  console.log(`    admin      ${UAT_ADMIN.email}      ${totpSecrets[UAT_ADMIN.email]}`);

  // -------------------------------------------------------------------------
  // 2. Promote UAT_ADMIN to admin role
  // -------------------------------------------------------------------------

  await db
    .insert(systemRoles)
    .values({ userId: ids[UAT_ADMIN.email]!, role: 'admin' })
    .onConflictDoNothing();
  console.log(`  admin role ensured for ${UAT_ADMIN.email}`);

  // -------------------------------------------------------------------------
  // 3. Create mentor grant: mentor → applicant (status = 'active')
  //    mentor_grants.id is app-supplied text (legacy, see ADR-020 / schema)
  // -------------------------------------------------------------------------

  const grantId = `uat-grant-${ids[UAT_MENTOR.email]!.slice(0, 8)}-${ids[UAT_APPLICANT.email]!.slice(0, 8)}`;
  await db.insert(mentorGrants).values({
    id: grantId,
    mentorUserId: ids[UAT_MENTOR.email]!,
    applicantUserId: ids[UAT_APPLICANT.email]!,
    grantedByUserId: ids[UAT_ADMIN.email]!,
    status: 'active',
    permissions: [],
  });
  console.log(`  mentor grant created: ${UAT_MENTOR.email} → ${UAT_APPLICANT.email}`);

  // -------------------------------------------------------------------------
  // 4. Resolve a category for the sample experience
  // -------------------------------------------------------------------------

  let [cat] = await db
    .select({ id: experienceCategories.id })
    .from(experienceCategories)
    .where(eq(experienceCategories.isActive, true))
    .limit(1);

  if (!cat) {
    console.log('  No active categories found — seeding categories now');
    await db.insert(experienceCategories).values(CATEGORIES).onConflictDoNothing();
    [cat] = await db
      .select({ id: experienceCategories.id })
      .from(experienceCategories)
      .where(eq(experienceCategories.isActive, true))
      .limit(1);
  }

  if (!cat) {
    console.warn('  Still no active categories after seeding — skipping experience creation');
  } else {
    // Resolve the user id from the freshly-created applicant record.
    const [applicantUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, UAT_APPLICANT.email));

    if (!applicantUser) {
      throw new Error(`Could not find user record for ${UAT_APPLICANT.email}`);
    }

    await db.insert(experiences).values({
      ownerUserId: applicantUser.id,
      categoryId: cat.id,
      organization: 'UAT Sample Hospital',
      position: 'Volunteer',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-03-31'),
      dutiesNarrative: 'Assisted in the emergency department during UAT testing.',
      totalHours: 120,
      hoursPerWeek: 10,
      numberOfWeeks: 12,
      permissionToContact: false,
      contactFirstName: 'Jane',
      contactLastName: 'Smith',
      contactEmail: 'jane.smith@uatsample.com',
      contactPhone: '+15551234567',
      isVolunteer: true,
    });
    console.log(`  experience created for ${UAT_APPLICANT.email}`);
  }

  console.log('seed:uat — complete');
  process.exit(0);
} catch (err) {
  console.error('seed:uat failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
