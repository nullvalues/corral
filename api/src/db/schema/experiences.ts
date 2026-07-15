// app-owned tables and enums: experience_categories (DB-005), frequency_of_experience enum (DB-006),
// experiences (DB-007) — Phase 5.
// Management surface deferred per story DB-005: seed script DB-015, CRUD API API-005/006, admin UI UI-017.
// experiences management surface: API API-007–API-011 (Phase 6), UI Phase 7/8.
// contact columns (DB-011): nullable PII. E.164 phone CHECK.
// text-length CHECKs (DB-012): org/position (<=256), duties_narrative (<=8192), contact name fields (<=128), contact_email (<=320).
// verification columns (DB-021): verificationStatus (NOT NULL DEFAULT 'unverified'), verifiedByUserId (nullable, <=255), verifiedAt (nullable timestamptz).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const frequencyOfExperience = pgEnum('frequency_of_experience', [
  'temporary',
  'recurring',
  'ongoing',
]);

export const experienceCategories = pgTable(
  'experience_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    // goal_hours (DB-024, PM036): nullable per-category target hours.
    // null = "no hour minimum" (distinct from 0). Operator-editable via UI-075.
    goalHours: integer('goal_hours'),
  },
  (t) => [
    check('experience_categories_slug_format', sql`${t.slug} ~ '^[a-z][a-z0-9-]{0,63}$'`),
    check('experience_categories_name_len', sql`char_length(${t.name}) <= 128`),
    check('experience_categories_goal_hours_nonneg', sql`${t.goalHours} IS NULL OR ${t.goalHours} >= 0`),
  ],
);

// experiences — app-owned table (DB-007, Phase 5).
// ownerUserId references users.id conceptually only — no Drizzle references() per ADR-003 (BA owns identity).
// categoryId FK is app-internal (both tables app-owned) and therefore ALLOWED per ADR-003.
// Management surface deferred: API API-007–API-011 (Phase 6), UI Phase 7/8.
// hours triple (DB-008) added — see ADR-012.
// location (DB-009) added — see ADR-013. Attestation (DB-010), contact (DB-011) columns added by later stories.
// text-length CHECKs added in DB-012; location CHECKs in DB-009, contact CHECKs in DB-011.
export const experiences = pgTable(
  'experiences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id').notNull(),
    categoryId: uuid('category_id').notNull().references(() => experienceCategories.id),
    organization: text('organization').notNull(),
    position: text('position').notNull(),
    frequency: frequencyOfExperience('frequency'),
    startDate: date('start_date', { mode: 'date' }).notNull(),
    endDate: date('end_date', { mode: 'date' }),
    dutiesNarrative: text('duties_narrative').notNull(),
    totalHours: integer('total_hours').notNull(),
    hoursPerWeek: integer('hours_per_week').notNull(),
    numberOfWeeks: integer('number_of_weeks').notNull(),
    // Location columns (DB-009, Phase 5) — all nullable, all text. See ADR-013.
    stateProvince: text('state_province'),
    stateProvinceCode: text('state_province_code'),
    country: text('country'),
    countryIso2: text('country_iso2'),
    countryIso3: text('country_iso3'),
    // Attestation booleans (DB-010, Phase 5) — all NOT NULL DEFAULT false. See ADR-014.
    // permissionToContact is load-bearing for PII access control: Phase 6 gates contact_* fields on this flag.
    isCurrent: boolean('is_current').notNull().default(false),
    receivedAcademicCredit: boolean('received_academic_credit').notNull().default(false),
    receivedSalaryOrPayment: boolean('received_salary_or_payment').notNull().default(false),
    isVolunteer: boolean('is_volunteer').notNull().default(false),
    isMostImportant: boolean('is_most_important').notNull().default(false),
    permissionToContact: boolean('permission_to_contact').notNull().default(false),
    // Contact columns (DB-011, Phase 5) — all nullable text PII. See ADR-015.
    // E.164 phone format enforced here. Length CHECKs added in DB-012 (see ADR-016).
    // In Phase 6, these fields are gated behind permissionToContact for non-owner readers (ADR-014).
    contactTitle: text('contact_title'),
    contactFirstName: text('contact_first_name'),
    contactLastName: text('contact_last_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
    // Verification columns (DB-021): mentor sign-off on applicant experiences. See ADR-035.
    verificationStatus: text('verification_status').notNull().default('unverified'),
    verifiedByUserId: text('verified_by_user_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('experiences_owner_idx').on(t.ownerUserId),
    index('experiences_category_idx').on(t.categoryId),
    check('experiences_hours_triple', sql`${t.totalHours} = ${t.hoursPerWeek} * ${t.numberOfWeeks}`),
    check('experiences_total_hours_bounds', sql`${t.totalHours} > 0 AND ${t.totalHours} <= 100000`),
    check('experiences_hpw_bounds', sql`${t.hoursPerWeek} > 0 AND ${t.hoursPerWeek} <= 168`),
    check('experiences_weeks_bounds', sql`${t.numberOfWeeks} > 0`),
    // Location CHECKs (DB-009) — IS NULL OR guard prevents rejection of legitimate NULLs.
    check('experiences_state_province_len', sql`${t.stateProvince} IS NULL OR char_length(${t.stateProvince}) <= 128`),
    check('experiences_state_province_code_len', sql`${t.stateProvinceCode} IS NULL OR char_length(${t.stateProvinceCode}) <= 8`),
    check('experiences_country_len', sql`${t.country} IS NULL OR char_length(${t.country}) <= 128`),
    check('experiences_country_iso2_len', sql`${t.countryIso2} IS NULL OR char_length(${t.countryIso2}) = 2`),
    check('experiences_country_iso3_len', sql`${t.countryIso3} IS NULL OR char_length(${t.countryIso3}) = 3`),
    // Contact CHECKs (DB-011) — E.164 phone format. IS NULL OR guard for nullable column.
    check('experiences_contact_phone_e164', sql`${t.contactPhone} IS NULL OR ${t.contactPhone} ~ '^\\+[1-9]\\d{1,14}$'`),
    // Text-length CHECKs (DB-012) — completes the text-column sweep. See ADR-016.
    check('experiences_org_len', sql`char_length(${t.organization}) <= 256`),
    check('experiences_position_len', sql`char_length(${t.position}) <= 256`),
    check('experiences_narrative_len', sql`char_length(${t.dutiesNarrative}) <= 8192`),
    check('experiences_contact_title_len', sql`${t.contactTitle} IS NULL OR char_length(${t.contactTitle}) <= 128`),
    check('experiences_contact_first_name_len', sql`${t.contactFirstName} IS NULL OR char_length(${t.contactFirstName}) <= 128`),
    check('experiences_contact_last_name_len', sql`${t.contactLastName} IS NULL OR char_length(${t.contactLastName}) <= 128`),
    check('experiences_contact_email_len', sql`${t.contactEmail} IS NULL OR char_length(${t.contactEmail}) <= 320`),
    // DB-018 / CER-011: 255-char CHECK on BA-identity soft reference. See ADR-026.
    check('experiences_owner_user_id_len', sql`char_length(${t.ownerUserId}) <= 255`),
    // DB-021: verification status value CHECK and nullable verifiedByUserId length CHECK (<=255 per ADR-026).
    check('experiences_verification_status_values', sql`${t.verificationStatus} IN ('unverified', 'verified')`),
    check('experiences_verified_by_user_id_len', sql`${t.verifiedByUserId} IS NULL OR char_length(${t.verifiedByUserId}) <= 255`),
  ],
);
