# asp — Architecture

## What asp is

asp is a locked-stack, single-tenant multi-user SPA template. The working reference
implementation is a skills database for entry-level applicants (resume-style
experiences across categories). Downstream forks adapt the patterns; asp demonstrates
the disciplined version. See `docs/brief.md` (what and why) and `docs/ideology.md`
(convictions and constraints).

This document is the source of truth for the asp codebase. Read it before any task.

---

## Stack

React 19 + Vite + TypeScript + TailwindCSS (SPA); Fastify + Drizzle ORM + Better Auth (API); Vitest + Playwright; pnpm monorepo

---

## Domain model

### experience_categories

App-owned table. Schema-only in Phase 5 (DB-005).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` — app-owned table, uuid allowed per DB-014 ADR |
| slug | text NOT NULL UNIQUE | `~ '^[a-z][a-z0-9-]{0,63}$'` CHECK |
| name | text NOT NULL | `char_length(name) <= 128` CHECK |
| sort_order | integer NOT NULL | default 0 |
| is_active | boolean NOT NULL | default true |
| goal_hours | integer | Nullable. `null` = "no hour minimum" (distinct from `0`). CHECK `experience_categories_goal_hours_nonneg`: `goal_hours IS NULL OR goal_hours >= 0`. DB-024, ADR-039. |
| created_at | timestamp NOT NULL | default now() |

Management surface: seed script DB-015, CRUD API API-005/API-006 (Phase 6), admin UI UI-017 (Phase 8). `goal_hours` editable via `CategoriesAdminPage` (UI-075); exposed on category read responses via API-041 (PM036).

### frequency_of_experience

Postgres native enum. Defined in Phase 5 (DB-006). Consumed by `experiences.frequency` column added in DB-007.

| Value | Meaning |
|-------|---------|
| `temporary` | Short-term or one-off experience (e.g. summer job, short contract) |
| `recurring` | Periodic experience that repeats but is not continuous |
| `ongoing` | Continuous, currently-active experience |

Values are operator-confirmed VMCAS vocabulary. The enum has no management surface of its own — values are fixed at the schema level; adding a new value requires a schema migration and a new ADR note.

### experiences

App-owned table. Core fields in Phase 5 (DB-007). Hours triple added in DB-008 (see ADR-012). Location (DB-009), attestation (DB-010), contact (DB-011), and text-length CHECKs (DB-012) added by subsequent stories.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` |
| owner_user_id | text NOT NULL | References `users.id` conceptually — no Drizzle `references()` per ADR-003 (BA owns identity). Indexed (`experiences_owner_idx`). CHECK `experiences_owner_user_id_len`: `char_length(owner_user_id) <= 255` (DB-018, closes CER-011 — matches the bound on `pii_access_log.actor_user_id`). See ADR-026. |
| category_id | uuid NOT NULL FK | References `experience_categories.id`. App-internal FK; allowed per ADR-003. Indexed (`experiences_category_idx`). |
| organization | text NOT NULL | `char_length(organization) <= 256` CHECK (`experiences_org_len`) |
| position | text NOT NULL | `char_length(position) <= 256` CHECK (`experiences_position_len`) |
| frequency | frequency_of_experience | Nullable — route layer (Phase 6) may require it |
| start_date | date NOT NULL | `mode: 'date'` |
| end_date | date | Nullable |
| duties_narrative | text NOT NULL | `char_length(duties_narrative) <= 8192` CHECK (`experiences_narrative_len`) |
| total_hours | integer NOT NULL | CHECK `experiences_total_hours_bounds`: `total_hours > 0 AND total_hours <= 100000` |
| hours_per_week | integer NOT NULL | CHECK `experiences_hpw_bounds`: `hours_per_week > 0 AND hours_per_week <= 168` |
| number_of_weeks | integer NOT NULL | CHECK `experiences_weeks_bounds`: `number_of_weeks > 0` |
| state_province | text | Nullable. CHECK `experiences_state_province_len`: `state_province IS NULL OR char_length(state_province) <= 128` |
| state_province_code | text | Nullable. CHECK `experiences_state_province_code_len`: `state_province_code IS NULL OR char_length(state_province_code) <= 8` |
| country | text | Nullable. CHECK `experiences_country_len`: `country IS NULL OR char_length(country) <= 128` |
| country_iso2 | text | Nullable. CHECK `experiences_country_iso2_len`: `country_iso2 IS NULL OR char_length(country_iso2) = 2` |
| country_iso3 | text | Nullable. CHECK `experiences_country_iso3_len`: `country_iso3 IS NULL OR char_length(country_iso3) = 3` |
| is_current | boolean NOT NULL | default false |
| received_academic_credit | boolean NOT NULL | default false |
| received_salary_or_payment | boolean NOT NULL | default false |
| is_volunteer | boolean NOT NULL | default false |
| is_most_important | boolean NOT NULL | default false |
| permission_to_contact | boolean NOT NULL | default false — consent is opt-in; load-bearing for PII access control in Phase 6 (API-007/API-008) |
| contact_title | text | Nullable PII. CHECK `experiences_contact_title_len`: `contact_title IS NULL OR char_length(contact_title) <= 128` |
| contact_first_name | text | Nullable PII. CHECK `experiences_contact_first_name_len`: `contact_first_name IS NULL OR char_length(contact_first_name) <= 128` |
| contact_last_name | text | Nullable PII. CHECK `experiences_contact_last_name_len`: `contact_last_name IS NULL OR char_length(contact_last_name) <= 128` |
| contact_email | text | Nullable PII. CHECK `experiences_contact_email_len`: `contact_email IS NULL OR char_length(contact_email) <= 320` |
| contact_phone | text | Nullable PII. CHECK `experiences_contact_phone_e164`: `contact_phone IS NULL OR contact_phone ~ '^\+[1-9]\d{1,14}$'` |
| created_at | timestamp NOT NULL | default now() |
| updated_at | timestamp NOT NULL | default now() |
| verification_status | text NOT NULL | default `'unverified'`. CHECK `experiences_verification_status_values`: `IN ('unverified', 'verified')`. DB-021, ADR-035. |
| verified_by_user_id | text | Nullable soft reference to `users.id` — no Drizzle FK per ADR-003. CHECK `experiences_verified_by_user_id_len`: `IS NULL OR char_length(verified_by_user_id) <= 255`. DB-021, ADR-035. |
| verified_at | timestamptz | Nullable. Records when verification was applied. DB-021, ADR-035. |

Multi-column CHECK: `experiences_hours_triple` — `total_hours = hours_per_week * number_of_weeks`. Phase 6 mirrors these bounds as Zod validation. See ADR-012.

Location columns added in DB-009 (Phase 5). All nullable — location is optional per the experience data model. ISO codes have exact-length CHECKs; free-text fields use max-length CHECKs. All CHECKs use `IS NULL OR` guard. See ADR-013.

Attestation boolean columns added in DB-010 (Phase 5). All NOT NULL DEFAULT false. `permission_to_contact` is load-bearing for PII access control: Phase 6 (API-007/API-008) gates exposure of `contact_*` fields to non-owner readers on this flag. See ADR-014.

Contact PII columns added in DB-011 (Phase 5). All nullable text. `contact_phone` is format-validated as E.164 by a DB CHECK. Contact field length CHECKs (title/first/last <=128, email <=320) added in DB-012. In Phase 6, these fields are gated behind `permission_to_contact = true` for non-owner (mentor) readers. See ADR-015, ADR-016.

Management surface: schema-only in Phase 5. API API-007–API-011 (Phase 6, API-007/008/009/010/011 complete), UI Phase 7/8.

### pii_access_log

App-owned table. Schema-only in Phase 5 (DB-016). Append-only audit log — application code never issues `UPDATE` or `DELETE` against this table. See ADR-021.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` — DB-generated per ADR-020 |
| actor_user_id | text NOT NULL | User who performed the action. References `users.id` conceptually — no Drizzle FK per ADR-003. CHECK `pii_access_log_actor_len`: `char_length(actor_user_id) <= 255` |
| action | text NOT NULL | `'read' | 'create' | 'update' | 'delete'`. CHECK `pii_access_log_action_values` enforces allowed values. |
| resource_type | text NOT NULL | The type of resource accessed (e.g. `'experience'`). CHECK `pii_access_log_resource_type_len`: `char_length(resource_type) <= 64` |
| resource_id | uuid | Nullable. The PK of the accessed resource. |
| subject_user_id | text | Nullable. The user whose PII was accessed (the applicant). CHECK `pii_access_log_subject_len`: `IS NULL OR char_length(subject_user_id) <= 255`. Indexed (`pii_access_log_subject_idx`). |
| via_grant | boolean NOT NULL | `false` by default. `true` when access was via a mentor grant rather than direct ownership. |
| created_at | timestamp NOT NULL | default now() |

Management surface: append-only audit log; qualifies for schema-gate exception per ADR-021 (no management UI required). Phase 6 write path via API-015 inserts a log entry whenever contact PII is read or mutated.

### admin_action_log

App-owned table. Schema-only in Phase 10 (DB-019). Append-only audit log — application code never issues `UPDATE` or `DELETE` against this table. Closes CER-013 (admin-action audit gap). The write helper that records admin actions on `POST /api/mentor-grants`, `PATCH /api/mentor-grants/:id`, `POST /api/experience-categories`, `PATCH /api/experience-categories/:id`, and `DELETE /api/experience-categories/:id` is wired in API-025 (category_delete added API-051). API-032 adds a second `grant_review` audit row (action: `'grant_review'`) on `PATCH /api/mentor-grants/:id` when the grant transitions from `pending` to `active` or `revoked`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` — DB-generated per ADR-020 |
| actor_user_id | text NOT NULL | The admin who performed the action. References `users.id` conceptually — no Drizzle FK per ADR-003. CHECK `admin_action_log_actor_len`: `char_length(actor_user_id) <= 255` |
| action | text NOT NULL | Action verb. Canonical values: `'grant_create'`, `'grant_update'`, `'grant_review'`, `'category_create'`, `'category_update'`, `'category_delete'`, `'role_change'`. CHECK `admin_action_log_action_len`: `char_length(action) <= 64`. CHECK `admin_action_log_action_values` constrains to exactly the seven canonical values (DB-022, ADR-036; `category_delete` added DB-030, ADR-043). |
| resource_type | text NOT NULL | Resource kind (e.g. `'mentor_grant'`, `'experience_category'`). CHECK `admin_action_log_resource_type_len`: `char_length(resource_type) <= 64` |
| resource_id | text NOT NULL | PK of the affected resource. Text (not uuid) because `mentor_grants.id` is app-supplied text per ADR-020. CHECK `admin_action_log_resource_id_len`: `char_length(resource_id) <= 255` |
| before | jsonb | Nullable. Snapshot of the resource before the action (NULL for create). |
| after | jsonb | Nullable. Snapshot of the resource after the action (NULL for delete). |
| created_at | timestamp NOT NULL | default now() |

Management surface: append-only audit log; qualifies for the schema-gate exception (same precedent as `pii_access_log` per ADR-021 — no management UI required). API-025 wires the write helper into the five admin write routes (four original routes + `DELETE /api/experience-categories/:id` added by API-051).

### readiness_config

App-owned table. Single-row operator config (Phase PM036-main, DB-025). Stores the three client-side readiness weights and the Platinum mentor threshold. No `UPDATE`/`DELETE` outside the admin weights editor. See ADR-039.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Always `'default'`. CHECK `readiness_config_singleton`: `id = 'default'` enforces the single-row invariant. |
| w_goal | float8 NOT NULL | Goal-progress weight. Default `0.6`. CHECK `readiness_config_w_goal_bounds`: `w_goal >= 0 AND w_goal <= 1`. |
| w_verified | float8 NOT NULL | Verified-ratio weight. Default `0.25`. CHECK `readiness_config_w_verified_bounds`: `w_verified >= 0 AND w_verified <= 1`. |
| w_breadth | float8 NOT NULL | Category-breadth weight. Default `0.15`. CHECK `readiness_config_w_breadth_bounds`: `w_breadth >= 0 AND w_breadth <= 1`. |
| platinum_hours | integer NOT NULL | Platinum mentor level threshold. Default `1000`. CHECK `readiness_config_platinum_hours_pos`: `platinum_hours > 0`. Operator-configurable via `PUT /api/admin/readiness-config`. API-063. |
| updated_at | timestamp NOT NULL | default now(). Updated by `updateReadinessConfig()`. Not included in `GET /api/readiness-config` response. |

Management surface: `PUT /api/admin/readiness-config` (API-042); admin UI at `/admin/settings` — `ReadinessSettingsPage` (UI-076, PM036). `platinumHours` added API-063 (PM052-main).

### system_roles

App-owned table. Schema introduced Phase 4 (DB-003); value CHECK on `role` added DB-017 (Phase 5, ADR-022); identity-column length CHECK added DB-018 (Phase 10, ADR-026). RBAC pivot: stores the system-level role (`admin` | `applicant`) for each user. See ADR-007.

| Column | Type | Notes |
|--------|------|-------|
| user_id | text NOT NULL | References `users.id` conceptually — no Drizzle FK per ADR-003 / ADR-007. Part of composite PK. CHECK `system_roles_user_id_len`: `char_length(user_id) <= 255` (DB-018, closes CER-011). See ADR-026. |
| role | text NOT NULL | `'admin' | 'applicant'`. Part of composite PK. CHECK `system_roles_role_values` enforces allowed values (DB-017, ADR-022). |

Primary key: composite `(user_id, role)`.

Management surface: applicant role assigned automatically by BA `databaseHooks.user.create.after` (Phase 4). Admin role bootstrapped via `pnpm --filter @asp/api admin:promote --email=<x>` CLI (INFRA-018); day-to-day admin promote/demote via `PATCH /api/users/:id/roles` (API-030).

### mentor_grants

App-owned table. Schema introduced Phase 4 (DB-004); value CHECK on `status` added DB-017 (Phase 5, ADR-022); identity-column length CHECKs added DB-018 (Phase 10, ADR-026). ABAC pivot: an admin-granted record that lets one user (the mentor) read another user's (the applicant's) experiences. See ADR-008.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | App-supplied id (legacy Phase 4 decision, contrast ADR-020 for newer tables). |
| applicant_user_id | text NOT NULL | References `users.id` conceptually — no Drizzle FK per ADR-003. CHECK `mentor_grants_applicant_user_id_len`: `char_length(applicant_user_id) <= 255` (DB-018, closes CER-011). See ADR-026. |
| mentor_user_id | text NOT NULL | References `users.id` conceptually — no Drizzle FK per ADR-003. CHECK `mentor_grants_mentor_user_id_len`: `char_length(mentor_user_id) <= 255` (DB-018, closes CER-011). See ADR-026. |
| granted_at | timestamp NOT NULL | default now() |
| granted_by_user_id | text NOT NULL | The admin who created the grant. References `users.id` conceptually — no Drizzle FK per ADR-003. CHECK `mentor_grants_granted_by_user_id_len`: `char_length(granted_by_user_id) <= 255` (DB-018, closes CER-011). See ADR-026. **For applicant-initiated requests** (`requested_by_user_id` non-null): holds the applicant's own `users.id` at insert time (no admin actor exists yet at creation). The approving admin is recorded in `admin_action_log` with `action: 'grant_review'` at approval time. |
| status | text NOT NULL | `'pending' | 'active' | 'revoked'`. default `'active'`. CHECK `mentor_grants_status_values` enforces allowed values (DB-017, ADR-022; `pending` added DB-020, ADR-034). |
| permissions | text[] NOT NULL | default `[]`. Postgres array of permission strings; closed vocabulary: `'read'` and `'write'` only. CHECK `mentor_grants_permissions_values`: `permissions <@ ARRAY['read','write']::text[]` (DB-031, ADR-044). See ADR-008 for the no-join-table rationale. |
| requested_by_user_id | text | Nullable soft reference to `users.id` — no Drizzle FK per ADR-003. NULL = admin-created grant; non-null = applicant-initiated request (the applicant who originated it). CHECK `mentor_grants_requested_by_user_id_len`: `char_length(requested_by_user_id) <= 255` (DB-020, ADR-034; DB-023 corrected from `length` to `char_length`, closes CER-032). |

Management surface: admin CRUD via `/api/mentor-grants` routes (Phase 8); admin UI at `/admin/grants` (UI-018, UI-019). Mentor-facing surface: `GET /api/mentor-grants/mine` (API-021) and the `ApplicantPicker` component (UI-020). Applicant-initiated requests: `POST /api/mentor-grants/requests` (API-031). Admin grant review queue (list pending + approve/reject with audit log): `GET /api/mentor-grants?status=pending` and `PATCH /api/mentor-grants/:id` extended in API-032. Applicant-facing grant status: `GET /api/mentor-grants/my-requests` (API-036).

### interview_shortlist

App-owned table. Schema introduced Phase PM037 (DB-026). Reviewer-private ABAC pivot: one row per `(reviewer, applicant)` pair holding a reviewer's private star rating and shortlist flag for an applicant. Reviewer-owned — reads are isolated to `reviewer_user_id = caller` (API-043 left-join); writes are gated by an active mentor grant via `hasMentorGrant` (API-044). No Drizzle `references()` to `users` per ADR-003 (BA owns identity). See ADR-040.

| Column | Type | Notes |
|--------|------|-------|
| reviewer_user_id | text NOT NULL | The reviewer who owns this row. References `users.id` conceptually — no Drizzle FK per ADR-003. Part of composite PK. CHECK `interview_shortlist_reviewer_user_id_len`: `char_length(reviewer_user_id) <= 255` (ADR-026). |
| applicant_user_id | text NOT NULL | The applicant being rated. References `users.id` conceptually — no Drizzle FK per ADR-003. Part of composite PK. CHECK `interview_shortlist_applicant_user_id_len`: `char_length(applicant_user_id) <= 255` (ADR-026). |
| star_rating | integer | Nullable. Reviewer's private 0–5 rating. CHECK `interview_shortlist_star_rating_bounds`: `star_rating IS NULL OR (star_rating >= 0 AND star_rating <= 5)`. |
| shortlisted | boolean NOT NULL | default false. Whether the reviewer has shortlisted the applicant. |
| created_at | timestamp NOT NULL | default now(). |
| updated_at | timestamp NOT NULL | default now(). |

Primary key: composite `(reviewer_user_id, applicant_user_id)`.

Management surface: reviewer-private read/write API (API-043 read, API-044 write, Phase PM037); mentor workspace UI (talent-pool / review surfaces). No admin management UI — the data is reviewer-private ABAC content, not operator config.

### milestone_award

App-owned table. Schema introduced Phase PM038-main (DB-027). Records awarded milestones for applicants — persisted history of reached milestone events. Application code inserts via `awardMilestones()` worker only; idempotent via `(user_id, milestone_key)` composite unique constraint + `ON CONFLICT DO NOTHING`. See ADR-041.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` — DB-generated per ADR-020 |
| user_id | text NOT NULL | The applicant who earned the milestone. References `users.id` conceptually — no Drizzle FK per ADR-003. Part of composite unique constraint `milestone_award_user_key_uq`. CHECK `milestone_award_user_id_len`: `char_length(user_id) <= 255` (ADR-026). Indexed (`milestone_award_user_idx`). |
| milestone_key | text NOT NULL | The unique key for the milestone earned (e.g., `'first-experience'`, `'hours-100'`, `'all-verified'` — hyphens, matching `MILESTONE_DEFS` keys). Part of composite unique constraint `milestone_award_user_key_uq`. CHECK `milestone_award_key_len`: `char_length(milestone_key) <= 64`. |
| earned_at | timestamp NOT NULL | default now(). Records when the milestone was awarded — the canonical historical fact. |

Primary key: `id` (uuid). Composite unique: `milestone_award_user_key_uq` on `(user_id, milestone_key)` enforces idempotent award semantics (a user earns each milestone exactly once; duplicate award attempts are silently rejected by the DB).

Management surface: append-only system-writer award worker (`awardMilestones()` in `api/src/services/milestones.ts`, invoked from `createExperience`/`updateExperience`/`verifyExperience`; DB-027, API-045) + admin audit read (`GET /api/admin/milestone-awards`, UI-081) for operator visibility. The table qualifies for the append-only audit exception (ADR-021) — application code never issues UPDATE or DELETE. Applicant self-read of earned milestones (GET /api/me/milestones, API-046) fetches rows from this table to confirm award state for the client-side celebration trigger.

### milestone_config

App-owned table. Schema introduced Phase PM052-main (API-064). Operator-configurable hour-threshold milestone definitions. Each row is one hour milestone (e.g. `hours-100`) that an admin can relabel, re-threshold, deactivate, or reorder **without a code deploy**. The migration seeds the three historical hour milestones (`hours-100`/`hours-500`/`hours-1000`) so out-of-the-box behaviour is unchanged.

| Column | Type | Notes |
|--------|------|-------|
| key | text PK | Immutable milestone key (e.g. `'hours-100'`). CHECK `milestone_config_key_len`: `char_length(key) <= 64` (matches `milestone_award_key_len` so a configured key can always be stored as an award). Not mutable via the admin PUT — supplied as a path param. |
| label | text NOT NULL | Display label. CHECK `milestone_config_label_len`: `char_length(label) <= 128`. Zod route bound: 1..128 (non-empty). |
| threshold_hours | integer NOT NULL | Hour threshold; the earned predicate is `totalHours >= threshold_hours`. CHECK `milestone_config_threshold_hours_pos`: `threshold_hours > 0`. Zod route bound: positive int. |
| is_active | boolean NOT NULL | default true. Only active rows participate in evaluation; a deactivated row stops being awardable/evaluated going forward. |
| sort_order | integer NOT NULL | default 0. Evaluation and admin-list ordering. |

**Structural vs configurable split (API-064, supersedes ADR-041 for hour milestones):** structural milestones (`first-experience`, `first-verified`, `all-verified`, `goal-1`/`goal-2`/`goal-all`, `breadth-3`) remain code-defined in `api/src/services/milestones.ts` because their earned predicate cannot be reduced to a single stored hour threshold. Hour-threshold milestones are loaded at runtime from this table (`WHERE is_active = true`, ordered by `sort_order`) and merged with the structural set by `buildMilestoneDefs()`. The server is now the single source of truth for hour-threshold definitions; `ui/src/lib/milestones.ts` no longer mirrors them — the client displays the fully-evaluated list returned by `GET /api/me/milestones`. Structural keys/predicates still mirror the UI's structural display metadata.

**Config-change tolerance:** awards are historical facts. An already-awarded key whose `milestone_config` row is later deactivated or re-thresholded is never retro-revoked — the stored `milestone_award` row stays. Deactivation / re-thresholding only changes whether the key is awardable (and evaluated) going forward. Because a deactivated row drops out of the evaluated definition list, its key is absent from the `GET /api/me/milestones` response even though the historical `milestone_award` row remains in the DB.

Management surface: `GET /api/admin/milestone-config` (list all rows, active + inactive, ordered by `sort_order`) and `PUT /api/admin/milestone-config/:key` (update `label`/`thresholdHours`/`isActive`/`sortOrder`; key immutable; 404 on unknown key) — both admin-gated (`requireRole('admin')`), in `api/src/routes/milestone-awards.ts`. API-064.

### user_profiles

App-owned table. Schema introduced Phase PM040-main (DB-028). Stores applicant-supplied profile metadata beyond what Better Auth's `users` table holds — school, graduation year, and bio. A separate table keeps BA-owned rows untouched while allowing schema evolution. No Drizzle `references()` to `users` per ADR-003 (BA owns identity). See DB-028. DB-032 (Phase PM046-main) added `major`, `gpa`, `phone`, `linkedin_url`, `portfolio_url` — all nullable text with CHECK constraints; GPA stored as text by design (precision/format flexibility; accommodates variants like "3.85" and "4.0/4.0"); phone constrained to E.164 like `experiences.contact_phone`. DB-034 (Phase PM053-main) added `headshot_key` and `resume_key` — nullable S3 object keys (≤512 chars each); URLs are never persisted, always generated as pre-signed on demand (API-065).

| Column | Type | Notes |
|--------|------|-------|
| user_id | text PK | Soft reference to `users.id` — no Drizzle FK per ADR-003. |
| school | text | Nullable. CHECK `user_profiles_school_len`: `school IS NULL OR char_length(school) <= 256`. |
| graduation_year | smallint | Nullable. CHECK `user_profiles_grad_year_range`: `graduation_year IS NULL OR (graduation_year >= 2000 AND graduation_year <= 2100)`. |
| bio | text | Nullable. CHECK `user_profiles_bio_len`: `bio IS NULL OR char_length(bio) <= 500`. |
| major | text | Nullable. CHECK `user_profiles_major_len`: `major IS NULL OR char_length(major) <= 128`. DB-032. |
| gpa | text | Nullable. Stored as text (not float) to avoid binary precision issues and to accommodate scale variants. CHECK `user_profiles_gpa_len`: `gpa IS NULL OR char_length(gpa) <= 8`. DB-032. |
| phone | text | Nullable PII. CHECK `user_profiles_phone_e164`: `phone IS NULL OR phone ~ '^\+[1-9]\d{1,14}$'` (same E.164 regex as `experiences.contact_phone`). DB-032. |
| linkedin_url | text | Nullable. CHECK `user_profiles_linkedin_url_len`: `linkedin_url IS NULL OR char_length(linkedin_url) <= 256`. DB-032. Scheme restricted to `http/https` at the API layer (Zod `.refine()` in `PATCH /api/me/profile`; `javascript:` and `data:` values return 400 — API-066); no DB-level scheme CHECK. |
| portfolio_url | text | Nullable. CHECK `user_profiles_portfolio_url_len`: `portfolio_url IS NULL OR char_length(portfolio_url) <= 256`. DB-032. Scheme restricted to `http/https` at the API layer (same as `linkedin_url` — API-066); no DB-level scheme CHECK. |
| headshot_key | text | Nullable. S3 object key for the user's headshot (e.g. `headshots/<userId>.jpg`). Stores the key, not a URL — pre-signed URLs are generated on demand (API-065). CHECK `user_profiles_headshot_key_len`: `headshot_key IS NULL OR char_length(headshot_key) <= 512`. DB-034. |
| resume_key | text | Nullable. S3 object key for the user's resume (e.g. `resumes/<userId>.pdf`). Stores the key, not a URL — pre-signed URLs are generated on demand (API-065). CHECK `user_profiles_resume_key_len`: `resume_key IS NULL OR char_length(resume_key) <= 512`. DB-034. |
| updated_at | timestamp NOT NULL | default now(). |

Management surface: `ProfilePage` edit form (UI-108/UI-109, PM053-main) — applicants self-manage their own row at `/profile`. No admin management surface required: rows are applicant-owned personal metadata with no cross-user or compliance oversight semantics (management-surface exception recorded per conceptual-rebuild-completeness policy).

### flag_report

App-owned table. Schema introduced Phase PM048-main (DB-033). Reviewer-private flags on experiences — a reviewer's escalation record when they spot a problematic experience, one row per `(reviewer_user_id, experience_id)` pair. Soft refs only per ADR-003: `reviewer_user_id` and `resolved_by_user_id` reference `users.id` conceptually, `experience_id` references `experiences.id` conceptually — no Drizzle `references()`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` — DB-generated per ADR-020 |
| reviewer_user_id | text NOT NULL | The reviewer who raised the flag. Soft ref to `users.id` per ADR-003. CHECK `flag_report_reviewer_len`: `char_length(reviewer_user_id) <= 255` (ADR-026). Indexed (`flag_report_reviewer_idx`). |
| experience_id | uuid NOT NULL | The flagged experience. Soft ref to `experiences.id` per ADR-003. Indexed (`flag_report_experience_idx`). |
| reason | text NOT NULL | Free-text reason for the flag. CHECK `flag_report_reason_len`: `char_length(reason) <= 1024`. |
| status | text NOT NULL | default `'open'`. CHECK `flag_report_status_values`: `status IN ('open','resolved')`. Admin resolves via `PATCH /api/admin/flags/:id` (API-059) — the open → resolved transition. |
| resolved_by_user_id | text | Nullable soft ref to `users.id`. CHECK `flag_report_resolved_by_len`: `resolved_by_user_id IS NULL OR char_length(resolved_by_user_id) <= 255`. |
| resolved_at | timestamptz | Nullable. Set when an admin resolves the flag. |
| created_at | timestamp NOT NULL | default now(). |

Management surface: admin flag review view (UI-101) for read/resolve; reviewer writes via `POST /api/experiences/:id/flag` (API-059).

## Auth model classification

**Classification:** both (RBAC + ABAC coexistence)

- **RBAC layer** — system-level role checks via `rbacGuard.ts` (`requireRole()`, `denyRole()`). Governs admin routes, mentor-grants management, and system config. Roles stored in `system_roles` table.
- **Authentication gate** — `requireAuth()` (`requireAuth.ts`) is the declarative preHandler for ABAC-only routes where any authenticated user may proceed and the service layer enforces ownership (e.g. `/api/me`, `/api/mentor/impact`). It replaces the hand-rolled inline `if (!request.user) → 401` guards; role-gated routes do not stack it on top of `requireRole()`, which already covers the null-user case (API-054). (Two residual inline guards remain in `GET /api/readiness-config` and `GET /api/experience-categories`; scheduled for migration in a future story.)
- **ABAC layer** — content-level access via `abacPredicates.ts` (`isOwner()`, `hasMentorGrant()`). Governs experience read/write ownership and mentor access-via-grant. PII gate (`applyPiiGate()`) is the central ABAC invariant.
- **Boundary:** `system_roles` and admin routes → RBAC. `experiences`, `pii_access_log`, `mentor_grants` content access → ABAC.

Established Phase 4 (DB-003/DB-004). See ADR-007, ADR-008, ADR-021.

---

## Module structure

```
asp/
├── api/                        # @asp/api — Fastify + Zod + Drizzle + Better Auth
│   ├── src/
│   │   ├── app.ts              # buildApp() — no I/O; all plugin + route registration
│   │   ├── index.ts            # Process entry: boot, listen, signal handlers only
│   │   ├── lib/
│   │   │   ├── config.ts         # ONLY approved process.env reader #1
│   │   │   ├── errors.ts         # ConfigError, NotImplementedError
│   │   │   ├── storage.ts        # StorageClient seam (ONLY @aws-sdk importer)
│   │   │   ├── ai.ts             # AiClient seam (ONLY @anthropic-ai/sdk importer)
│   │   │   ├── mailer.ts         # MailerClient seam + ConsoleMailerAdapter + createMailerClient factory. INFRA-020.
│   │   │   ├── mailerAdapters/
│   │   │   │   ├── console.ts    # ConsoleMailerAdapter — stdout logger + in-process reset-link ring buffer (UAT-005). getResetLinks() / clearResetLinks() exported.
│   │   │   │   └── resend.ts     # ResendMailerAdapter — ONLY approved resend SDK importer. INFRA-023.
│   │   │   └── auth-boundary.ts  # Auth-coexistence boundary registry — getBoundary(resourceType) throws if unregistered
│   │   ├── plugins/
│   │   │   ├── cors.ts             # @fastify/cors gate (fp-wrapped — see ADR-001)
│   │   │   ├── rateLimiter.ts      # @fastify/rate-limit scoped to auth paths and applicant mutation routes (fp-wrapped); three per-group limits share RATE_LIMIT_WINDOW_MS (default 60 s): RATE_LIMIT_MAX_AUTH (default 10) for sign-in/sign-up/password-reset/change-password, RATE_LIMIT_MAX_MFA (default 10) for verify-totp, RATE_LIMIT_MAX_API (default 30) for experiences/mentor-grant-requests; per-group keyGenerator prevents cross-bucket contamination. INFRA-053. API-024. INFRA-020 added /api/auth/request-password-reset. INFRA-032 added /api/auth/reset-password. UAT-023 added loopback bypass (127.0.0.1, ::1, ::ffff:127.0.0.1 always exempt). CER-019: loopback bypass assumes trustProxy=off — see docs/operations.md. API-049 added /api/experiences and /api/mentor-grants/requests. API-060 added /api/auth/change-password.
│   │   │   ├── storage.ts          # Fastify decorator for storageClient
│   │   │   ├── ai.ts               # Fastify decorator for aiClient
│   │   │   ├── mailer.ts           # Fastify decorator for mailerClient; fp-wrapped. INFRA-021.
│   │   │   ├── staticUi.ts         # @fastify/static SPA serving (fp-wrapped); no-op when STATIC_UI_ROOT unset. INFRA-013.
│   │   │   └── protectedScope.ts   # NOT fp-wrapped; encapsulates session + MFA gate (DI opts)
│   │   ├── routes/
│   │   │   ├── health.ts       # GET /api/health — unauthenticated liveness probe
│   │   │   ├── auth.ts         # /api/auth/* — delegates to Better Auth via toNodeHandler
│   │   │   ├── openapi.ts      # GET /api/openapi.json — public OpenAPI 3.0 spec; no auth required. API-013.
│   │   │   ├── shared-schemas.ts  # Canonical shared Zod response schemas across routes. Exports ErrorSchema (`z.object({ error: z.string() })`) — single source of truth for the API error envelope, imported by every route's error responses. API-053.
│   │   │   ├── experience-categories.ts  # GET/POST/PATCH/DELETE /api/experience-categories — auth-required list (API-005); admin-only write routes (API-006).
│   │   │   ├── experiences.ts  # GET/POST/PATCH/DELETE /api/experiences, GET /api/experiences/rollup, GET /api/experiences/export, GET /api/experiences/:id — ABAC with PII gate. API-007/008/009/010/011. GET /api/experiences/export — requireAuth; optional ?owner_user_id (defaults to caller); ABAC: a non-self owner_user_id is allowed only for admins (getMyRoles check), else 403; responds with a text/csv body (Content-Disposition attachment; filename="experiences-export.csv") built from listExperiencesByOwner() rows with a fixed 16-column order (organization, position, category [emits categoryId UUID — listExperiencesByOwner() does no join to experience_categories; a future story should either join and emit categoryName or rename the header to categoryId], frequency, startDate, endDate, totalHours, hoursPerWeek, numberOfWeeks, isVolunteer, receivedSalaryOrPayment, receivedAcademicCredit, isMostImportant, verificationStatus, stateProvince, country); local toCsvValue helper does RFC-4180 escaping (dates rendered YYYY-MM-DD); the 200 response deliberately has no Zod schema so the JSON serializer does not quote-wrap the CSV; declared before /experiences/:id so the static path is not shadowed. API-062. PATCH /api/experiences/:id/verification — mentor verify/un-verify; denyRole('admin') only (API-037 removed denyRole('applicant') — a caller with the applicant role AND an active write grant may verify); requires active write grant; self-verify blocked; non-existent IDs return 403 (not 404) when caller lacks a write grant (CER-035); writes pii_access_log action 'update' (API-033). POST body validates endDate > startDate when isCurrent is not true and endDate is non-null (400 if violated — UI-099); PATCH body applies the same guard only when both startDate and endDate are present in the patch.
│   │   │   ├── flags.ts        # POST /api/experiences/:id/flag — ABAC-gated reviewer flag creation (hasMentorGrant(caller, experience.ownerUserId, 'read')); non-existent experience ID and missing grant collapse to an identical 403 (non-disclosure, CER-035); body { reason: ≤1024 chars }; inserts flag_report row with status 'open', returns 201. GET /api/admin/flags — requireRole('admin'); optional ?status=open|resolved filter plus ?limit/?offset pagination; rows joined with experience (organization, position, ownerUserId) and reviewer (name, email). PATCH /api/admin/flags/:id — requireRole('admin'); resolves a flag (status='resolved', resolved_by_user_id=caller, resolved_at=now); idempotent on already-resolved; 404 for unknown id. No module-scope db import. API-059.
│   │   │   ├── mentor-grants.ts  # GET /api/mentor-grants — admin-only filterable list; optional ?status= filter validated as z.enum(['pending','active','revoked']) (API-052); response always includes applicantName/applicantEmail/mentorName/mentorEmail joined from users (API-020, API-032); writes one pii_access_log row per request (action: 'read', resourceType: 'mentor_grant_list', resourceId: null, subjectUserId: null, viaGrant: false) — fire-and-forget (API-058). POST /api/mentor-grants — admin-only grant creation; verifies both mentorUserId and applicantUserId exist in users table (400 if either missing — API-052) (API-018). PATCH /api/mentor-grants/:id — admin-only grant update; writes grant.update audit log on any update; additionally writes grant_review audit log when transitioning from pending → active or pending → revoked (API-019, API-032). GET /api/mentor-grants/mine — authenticated user's active grants with applicant join (API-021). GET /api/mentor-grants/my-requests — applicant-scoped; returns caller's own grants (all statuses) with mentor join (API-036). POST /api/mentor-grants/requests — applicant-only mentor request (creates pending grant; API-031).
│   │   │   ├── users.ts  # GET /api/users — dual-mode admin endpoint (ADR-033): ?email=<prefix> typeahead search with PII audit (API-022); ?page=N&pageSize=M paginated list with roles and active mentor grant counts (API-029). PATCH /api/users/:id/roles — admin promote/demote admin role with audit log (API-030).
│   │   │   ├── me.ts  # GET /api/me — authenticated user info, roles, hasMentorGrants. Path is /api/me (not /api/auth/me) to avoid conflict with authRoutes all-wildcard. API-023. GET /api/me/milestones — authenticated, self-scoped (req.user.id only; no subject param — ABAC guarantee); returns MilestoneView[] (earned flag from stored milestone_award rows, not predicate re-derivation). API-046. GET /api/me/profile — requireRole('applicant'); returns name/email from users + extended fields from user_profiles (school, graduationYear, bio, and — added API-057 — major, gpa, phone, linkedinUrl, portfolioUrl; all nullable, null when no row exists). PATCH /api/me/profile — requireRole('applicant'); body { name?, school?, graduationYear?, bio?, major?, gpa?, phone?, linkedinUrl?, portfolioUrl? } (all optional; phone validated E.164 `^\+[1-9]\d{1,14}$`, API-057; linkedinUrl and portfolioUrl restricted to http/https schemes only — `javascript:` and `data:` values return 400, API-066); upserts user_profiles and optionally updates users.name; returns updated profile. API-047, API-057, API-066.
│   │   │   ├── uploads.ts  # Upload/read/delete routes for headshots and resumes (API-065). Uses @fastify/multipart (registered inside this plugin scope). POST /api/me/headshot — requireAuth(); multipart; image/jpeg|png|webp only (415 otherwise); max 5 MB (413); uploads to S3 as headshots/<userId>.<ext> (ext server-derived from content-type); best-effort deletes old key when extension changes; updates user_profiles.headshot_key via updateProfileKeys(). GET /api/me/headshot — requireAuth(); pre-signed URL (30 min TTL); 404 if no key. POST /api/me/resume — requireAuth(); application/pdf only (415); max 10 MB (413); uploads as resumes/<userId>.pdf. GET /api/me/resume — requireAuth(); pre-signed URL; 404 if no key. DELETE /api/me/resume — requireAuth(); best-effort S3 delete then nulls resume_key; 204. GET /api/mentor/applicants/:id/resume — requireAuth(); ABAC-gated hasMentorGrant(caller, :id, 'read') (403 without grant); pre-signed URL for applicant's resume; 404 if none. All S3 keys are server-constructed from userId — no client filename reaches the key. Storage errors map to 502/500 (not raw SDK errors). API-065.
│   │   │   ├── mentor.ts  # GET /api/mentor/impact — authenticated, self-scoped (req.user.id only; no subject query param — ABAC guarantee). Derived mentor impact stats (computed, never stored); no RBAC role gate (mentorship is grant-based). API-040, ADR-038. GET /api/mentor/talent-pool — authenticated, ABAC-scoped (grant-scoped, no RBAC role gate — D5); returns raw readiness components (per-active-category hours/experience/verified counts, summed totals, activeCategoryCount) plus the caller's own interview_shortlist row (shortlisted/starRating) for each granted, non-admin applicant. Client computes + ranks; no persisted score. API-043. PATCH /api/mentor/applicants/:id/review — authenticated, ABAC-write-gated (hasMentorGrant(caller, :id, 'read') — no RBAC role gate); reviewer-owned interview_shortlist upsert of shortlisted + starRating (0–5|null); missing-applicant and no-grant collapse to an identical 403 (non-disclosure, CER-035). API-044. GET /api/mentor/applicants/:id/profile — authenticated, ABAC-read-gated (hasMentorGrant(caller, :id, 'read') — no RBAC role gate); returns the mentor-visible profile subset { name, school, graduationYear, bio, major, linkedinUrl, portfolioUrl } — deliberately excludes phone and gpa; missing-applicant and no-grant collapse to an identical 403 (non-disclosure, CER-035); on success writes a pii_access_log 'read' row (resourceType 'user_profile', resourceId null — the applicant is identified by subjectUserId; viaGrant true). API-057.
│   │   │   ├── pii-access-log.ts  # GET /api/admin/pii-log — admin-only read-only pii_access_log listing. TEST-025.
│   │   │   ├── milestone-awards.ts  # GET /api/admin/milestone-awards — admin-gated (requireRole('admin')); querystring { userId?, limit? (1–200) }; returns array of MilestoneAwardRowSchema (id, userId, email (nullable, LEFT JOIN users), milestoneKey, earnedAt); ordered by earned_at DESC; limit clamped 200 (default 100). No module-scope db import. UI-081. GET /api/admin/milestone-config — admin-gated; lists all milestone_config rows (active + inactive) ordered by sortOrder. PUT /api/admin/milestone-config/:key — admin-gated; updates label/thresholdHours/isActive/sortOrder (key immutable, path param); Zod: label 1..128, thresholdHours positive int; 404 on unknown key. API-064.
│   │   │   ├── readiness-config.ts  # GET /api/readiness-config — any authenticated user (401 when no session); returns the single-row readiness weights. PUT /api/admin/readiness-config — requireRole('admin'); body { wGoal, wVerified, wBreadth, platinumHours } — wGoal/wVerified/wBreadth each z.number().min(0).max(1); platinumHours positive int (API-063); all four fields required. .superRefine() asserts weights sum to 1.0 within 0.001 float tolerance (400 if not — API-052, direct API calls bypass the UI guard). Not audited in admin_action_log by design (DB-022 vocab closed; see API-042 note). API-042.
│   │   │   └── uat.ts             # GET /api/uat/reset-links — UAT-env-gated (no auth), returns reset-link ring buffer. Registered only when UAT=true. UAT-005.
│   │   ├── scripts/
│   │   │   ├── generate-openapi.ts  # Builds app, calls app.swagger(), writes api/openapi.json. API-014.
│   │   │   ├── migrate.ts           # Standalone CLI: reads DATABASE_URL, runs drizzle-orm/migrator against api/drizzle/. INFRA-017.
│   │   │   ├── adminPromote.ts      # Standalone CLI: --email=<x> → inserts (user_id, 'admin') into system_roles. INFRA-018.
│   │   │   ├── seed.prod.ts         # Standalone CLI: seeds VMCAS experience categories only; onConflictDoNothing — safe to re-run. INFRA-019.
│   │   │   └── stripApplicantRole.ts  # E2E helper CLI: --email=<x> removes the 'applicant' system role from a user. TEST-043. No longer called by experience-verification.spec.ts after API-037 removed denyRole('applicant') from the verification route — retained for potential future use.
│   │   │   # All files in scripts/ follow the standalone-CLI pattern: read env directly via dotenv/config, no Fastify process dependency.
│   │   ├── db/
│   │   │   ├── index.ts        # ONLY approved process.env reader #2; pool + drizzle instance
│   │   │   ├── aggregates.ts   # coerceCount() / coerceSum() helpers — centralised Drizzle SUM/COUNT string-to-number coercion (API-055)
│   │   │   ├── seed.ts         # Operator-runnable seed: VMCAS experience categories (DB-015) and readiness_config defaults (DB-025); exports CATEGORIES for unit tests
│   │   │   ├── seed.uat.ts     # UAT seed: three stable accounts (applicant/mentor/admin), mentor grant, PII-bearing experience. Approved direct process.env reader (standalone CLI). UAT-004. Self-seeds experience categories (imports CATEGORIES from seed.ts) if none exist — seed:prod is not a prerequisite.
│   │   │   ├── seed-uat-helpers.ts  # Exported helpers for seed.uat.ts: deleteAccountByEmail() (deletes all BA-owned rows for an email — sessions, accounts, verification, two-factor, user), ensureAccount() (sign-up-only with 429 retry/backoff honouring Retry-After header — UAT-024), enrollTotp() (sign-in → enable → verify TOTP via BA API; returns base32 secret — UAT-026), writeUatSecrets() (writes UatSecrets sidecar to e2e/uat/.uat-secrets.json relative to monorepo root — UAT-026), delay(). Extracted for unit testability. UAT-021/UAT-025/UAT-026.
│   │   │   ├── schema/
│   │   │   │   ├── auth.ts         # BA-owned tables (users, sessions, accounts, verification)
│   │   │   │   ├── roles.ts        # app-owned tables: system_roles, mentor_grants (ADR-007, ADR-008)
│   │   │   │   ├── experiences.ts  # app-owned tables: experience_categories + frequency_of_experience enum + experiences (Phase 5, DB-005/DB-006/DB-007)
│   │   │   │   ├── audit.ts        # app-owned tables: pii_access_log — append-only audit log (Phase 5, DB-016; see ADR-021); admin_action_log — append-only admin-action audit (Phase 10, DB-019; CER-013)
│   │   │   │   ├── readiness.ts     # app-owned table: readiness_config — single-row operator config (id='default') for client readiness weights wGoal/wVerified/wBreadth; CHECK singleton + per-weight [0,1] bounds (PM036, DB-025)
│   │   │   │   ├── interview-shortlist.ts  # app-owned table: interview_shortlist — reviewer-private (reviewer_user_id, applicant_user_id) composite-PK rows with star_rating (0–5) + shortlisted flag; CHECK bounds + 255-char identity CHECKs; no FK to users per ADR-003 (PM037, DB-026)
│   │   │   │   ├── milestone-award.ts  # app-owned tables: milestone_award — (user_id, milestone_key) composite-PK rows recording earned milestones with earned_at timestamp; UNIQUE constraint + ON CONFLICT DO NOTHING ensures idempotency; 255-char user_id + 64-char milestone_key CHECKs per ADR-026; auto-awarded by awardMilestones() system writer (PM038, DB-027, ADR-041). milestoneConfig — milestone_config table: operator-configurable hour-threshold milestone rows (key PK ≤64, label ≤128, threshold_hours >0 CHECKs; is_active/sort_order); admin-managed via GET/PUT /api/admin/milestone-config (API-064, PM052-main; supersedes ADR-041 hour-milestone mirror)
│   │   │   │   ├── user-profiles.ts  # app-owned table: user_profiles — applicant-owned personal metadata (school, graduation_year, bio) with per-column CHECKs (school ≤256, grad_year 2000–2100, bio ≤500); user_id PK is a soft reference to users.id per ADR-003; managed by ProfilePage edit form UI-088 (PM040, DB-028). DB-032 added major/gpa/phone/linkedin_url/portfolio_url (all nullable, length/format CHECKs). DB-034 added headshot_key/resume_key — nullable S3 object keys (≤512 chars each; keys-not-URLs; pre-signed on demand via API-065)
│   │   │   │   ├── flags.ts        # app-owned table: flag_report — reviewer-private escalation flags on experiences; (reviewer_user_id, experience_id) pair; status 'open'/'resolved' with CHECK; resolvedByUserId/resolvedAt on resolution; soft refs per ADR-003; management surface is FlagsAdminPage (UI-101); reviewer writes via POST /api/experiences/:id/flag (API-059). DB-033, PM048-main.
│   │   │   │   └── index.ts        # schema barrel re-export
│   │   └── services/
│   │       ├── experience-categories.ts  # listCategories(), createCategory(), getCategoryById(id), updateCategory(), deleteCategory() — experience_categories CRUD. API-005/006/API-025.
│   │       ├── experiences.ts  # listExperiencesByOwner(), getExperienceById(), createExperience(), updateExperience(), deleteExperience(), applyPiiGate(), getRollupByOwner(), verifyExperience() — ABAC + PII gate for experiences. API-007/008/009/010/011. verifyExperience(mentorUserId, experienceId, action) requires active write grant, blocks self-verify, writes pii_access_log action 'update' (API-033). Note: getRollupByOwner() totalHours typed as sql<string> (Postgres aggregate); callers coerce via coerceSum() from db/aggregates.ts (API-055).
│   │       ├── flags.ts  # createFlag(reviewerUserId, experienceId, reason) — inserts a flag_report row with status 'open'; persistence only, the route gates the write with hasMentorGrant (interview-shortlist.ts pattern). listFlags(opts: { status?, limit?, offset? }) — admin read: flag rows LEFT JOINed with experiences (organization, position, ownerUserId) and users (reviewerName, reviewerEmail); ordered by created_at DESC; limit clamped 200 (default 50). resolveFlag(flagId, resolvedByUserId) — open → resolved transition setting resolved_by_user_id + resolved_at; idempotent on already-resolved (returns the existing row); null for unknown id. API-059.
│   │       ├── mentor-grants.ts  # listMentorGrants(filters) — filterable list ordered by grantedAt DESC; joins users twice (applicant_users alias + mentor_users alias) to return applicantName/applicantEmail/mentorName/mentorEmail in every row; optional status filter (API-020, API-032). createMentorGrant() — insert mentor_grants row, UUID id (API-018). updateMentorGrant(id, patch) — partial update of status/permissions, returns null if not found (API-019). listMyMentorGrants(mentorUserId) — active grants for a mentor with applicantName/applicantEmail joined from users (API-021). listMyApplicantGrants(applicantUserId) — all grants for an applicant (all statuses) with mentorName/mentorEmail joined via mentor_users alias (API-036). getMentorGrantById(id) — returns a single grant or null; used for before-snapshot in API-025. requestMentorGrant(applicantUserId, mentorEmail) — applicant-initiated pending grant; 404 if email not found, conflict discriminant if pending/active grant exists (API-031).
│   │       ├── readiness-config.ts  # getReadinessConfig() — returns the single 'default' row { wGoal, wVerified, wBreadth }; defensively inserts defaults (0.6/0.25/0.15) on an empty table. updateReadinessConfig(weights) — upserts the 'default' row (updatedAt = now) and returns the new weights. API-042.
│   │       ├── pii-access-log.ts  # insertPiiAccessLog() — fire-and-forget PII audit insert; failures caught and re-logged as structured JSON with event key 'pii_access_log_write_failed' (non-PII identifiers only) so broken audit trails surface in application error logs (API-052). API-015. listPiiAccessLog(opts) — read-only list with optional mentorUserId/applicantUserId filters.
│   │       ├── adminActionLog.ts  # insertAdminActionLog() — async awaited admin-action audit insert. API-025, API-035.
│   │       ├── users.ts  # getUserById(userId) — returns {id, email, name} or null; used for user-existence checks in mentor-grants creation and verifier name resolution in notification emails (API-052, API-061). searchUsersByEmail(emailQuery) — prefix LIKE search returning {id, email, name}; input is LIKE-escaped (%, _, \) before query to prevent wildcard injection (API-022, API-026). listUsers(page, pageSize) — paginated full list joined with system_roles (aggregated) and active mentor_grants count; returns UserListResult {users, totalCount} (API-029). Known caveat: limit/offset is applied to the joined result; a user with multiple roles occupies multiple rows, so actual returned user count per page may be less than pageSize when multi-role users are present (see CER-030). getUserRoles(userId) — returns all system roles for a user. setAdminRole(actorId, targetUserId, action) — grant/revoke admin role with self-demotion and last-admin guards; writes admin_action_log row (API-030).
│   │       ├── me.ts  # getMyRoles(userId) — roles from system_roles. getHasActiveMentorGrants(userId) — true if active mentor_grants row exists. API-023.
│   │       ├── mentor-impact.ts  # getMentorImpact(mentorUserId) — derived, self-scoped mentor stats computed on demand (no table per ADR-038): monthHoursVerified, lifetimeHoursVerified, applicantsMentored, avgTurnaroundHours (verifiedAt−createdAt, createdAt is a submission proxy), streakDays, pendingVerifications (via active mentor_grants join). computeStreakDays(days, today) — pure, unit-testable consecutive-UTC-day run helper. SUM/COUNT strings coerced with Number (getRollupByOwner analogue). API-040.
│   │       ├── talent-pool.ts  # listTalentPool(mentorUserId) — grant-scoped ranked-candidate components: for each applicant the caller holds an ACTIVE mentor grant over (excluding system admins), returns per-active-category rollup (totalHours/experienceCount/verifiedCount, zero-filled, sortOrder), summed experienceCount/verifiedCount, activeCategoryCount, and the caller's OWN interview_shortlist row (shortlisted/starRating — reviewer read-isolation, D7). The mentor_grants filter (mentorUserId = caller AND status = 'active') IS the per-row hasMentorGrant enforcement (D5). Raw components only — no persisted readiness score; client computes + ranks. SUM/COUNT strings coerced with Number. API-043.
│   │       ├── interview-shortlist.ts  # upsertShortlistReview(reviewerUserId, applicantUserId, patch) — reviewer-owned insert(...).onConflictDoUpdate(...) on interview_shortlist keyed by the (reviewer_user_id, applicant_user_id) composite PK; sets shortlisted + starRating + updatedAt; returns the row. Persistence only — the route gates the write with hasMentorGrant. API-044.
│   │       ├── profile.ts  # getMyProfile(userId) — reads users.name/email + user_profiles extended fields (school, graduationYear, bio, major, gpa, phone, linkedinUrl, portfolioUrl — the last five added API-057; all nullable); returns null if user row missing. updateMyProfile(userId, patch) — upserts user_profiles (accepts the five new fields; omitted left unchanged, explicit null clears), optionally updates users.name; returns updated profile via getMyProfile. getApplicantProfileForMentor(applicantUserId) — mentor-scoped read returning the MentorProfileView subset { name, school, graduationYear, bio, major, linkedinUrl, portfolioUrl }; never phone or gpa; returns null if the applicant user row is missing (access control + PII audit are the route's responsibility). API-047, API-057. getProfileKeys(userId) — reads headshotKey/resumeKey columns from user_profiles; returns { headshotKey, resumeKey } (null when no row). updateProfileKeys(userId, keys) — upserts user_profiles setting headshotKey and/or resumeKey; used by POST upload routes. API-065.
│   │       ├── milestones.ts  # Milestone award worker + reads (API-045, API-046) + milestone_config CRUD (API-064). MILESTONE_DEFS — backward-compatible export = structural milestones merged with the DEFAULT hour seed (buildMilestoneDefs). API-064 splits definitions: STRUCTURAL milestones (first-experience, first-verified, all-verified, goal-*, breadth-3) stay code-defined with predicates; HOUR-THRESHOLD milestones load at runtime from milestone_config via loadActiveHourConfig() (WHERE is_active=true, ORDER BY sort_order) and are merged by buildMilestoneDefs() — awardMilestones() and getMyMilestones() both evaluate the live merged set, superseding the ADR-041 server↔client lock-step for hour milestones. listMilestoneConfig()/updateMilestoneConfig(key, patch) back the admin GET/PUT routes (updateMilestoneConfig returns null on unknown key → 404). Config-change tolerant: a deactivated/re-thresholded row is never retro-revoked (past milestone_award rows persist). getMilestoneContext(userId) — live per-user aggregate ({totalHours, experienceCount, verifiedCount, goalCategoriesMet, goalCategoriesTotal, categoriesWithExperience}) via one experiences aggregate query + a goal-bearing experience_categories join (is_active AND goal_hours IS NOT NULL); SUM/COUNT strings coerced with Number/parseInt (getRollupByOwner analogue). awardMilestones(userId) — evaluates every predicate, then insert(milestone_award).values(earned).onConflictDoNothing({target:[userId, milestoneKey]}).returning(...); returns only the NEWLY-inserted keys ([] on an idempotent re-run). System writer — no access decision of its own; awaited from createExperience/updateExperience/verifyExperience in experiences.ts so the award row exists before the mutation's HTTP response returns. getMyMilestones(userId) — reads stored milestone_award rows for the user and maps the live merged definition list (buildMilestoneDefs(loadActiveHourConfig()), API-064) to MilestoneView[] (earned from stored rows only, not predicate re-derivation; earnedAt as ISO string; remainingLabel from def.remaining(ctx) while locked). Deactivated hour rows drop out of the list so their key is absent from the response even if a historical award row exists. API-046, API-064. listMilestoneAwards(opts: { userId?, limit? }) — admin audit read; LEFT JOINs milestone_award to users for email (nullable); optional userId filter; ordered by earned_at DESC; limit clamped to 200 (default 100). UI-081.
│   │       └── auth/
│   │           ├── index.ts             # Better Auth configured instance (Drizzle adapter). emailAndPassword.sendResetPassword delegates to _mailerClient.sendPasswordReset; setMailer(m) is exported for injection from app.ts (AUTH-007). buildAuthConfig(isProduction, allowedOrigins?: string[]) passes ALLOWED_ORIGINS as trustedOrigins so BA accepts CSRF-checked requests (two-factor/enable, verify-totp, sign-out) from the Vite proxy origin in dev mode (ADR-032). INFRA-052 changed the second param from a single allowedOrigin string to the ALLOWED_ORIGINS array.
│   │           ├── sessionLoader.ts     # session-loader preHandler + request.user/session decoration
│   │           ├── mfaGate.ts           # MFA grace-window preHandler (4 branches)
│   │           ├── rbacGuard.ts         # requireRole(role) / denyRole(role) factories - RBAC preHandlers (system-level check only)
│   │           ├── requireAuth.ts       # requireAuth() factory - preHandler enforcing a non-null request.user (401 { error: 'Unauthorized' }) for ABAC-only routes where any authenticated user may proceed and the service layer enforces ownership. API-054.
│   │           ├── abacPredicates.ts    # ABAC predicates: isOwner(userId, resource) pure; hasMentorGrant(mentorUserId,   applicantUserId, permission) DB-backed (mentor_grants only)
│   │           └── types.ts             # FastifyRequest augmentation: user: UserWithTwoFactor|null
│   ├── drizzle/                # drizzle-kit migration output (Phase 2+)
│   └── tests/
│       ├── globalSetup.ts            # integration suite setup: env stubs, forced NODE_ENV=test, DB clean, assertTestDb
│       ├── loadDatabaseUrlTest.ts    # single-key loader: DATABASE_URL_TEST from api/.env.local for cold-shell gate (TEST-056)
│       └── api-040.integration.test.ts  # DB-backed integration tests for GET /api/mentor/impact (TEST-051). Asserts ABAC isolation (mentor A excludes mentor B rows), counter math (lifetimeHoursVerified/monthHoursVerified/applicantsMentored/avgTurnaroundHours/pendingVerifications against deterministic seed), empty-caller all-zero baseline, and 401 when unauthenticated.
├── ui/                         # @asp/ui — React 19 + Vite + Tailwind 4
│   └── src/
│       ├── App.tsx             # router definition; /two-factor route → TotpChallenge (UI-090, alongside /enrol → TotpEnrol); /experiences routes Phase 7; /admin + /admin/categories + /admin/grants routes Phase 8; /admin/users route UI-031; /mentor/:applicantUserId/experiences routes UI-021; /forgot-password route UI-023; /reset-password route UI-024. UI-063 nests the applicant-facing routes (/home, /experiences, /mentor-status, /profile) under ApplicantLayout (bottom tab bar). UI-071: /mentor is now the mentor desktop workspace root (MentorWorkspaceLayout) with an index dashboard (MentorDashboardPage) and a :applicantUserId child (MentorScopeLayout → experiences). The applicant mentor-status view moved from /mentor to /mentor-status to free the /mentor namespace for the workspace. UI-074: /mentor/:applicantUserId (index) → ApplicantReviewPage (B2 review screen). UI-076: /admin/settings route → ReadinessSettingsPage (admin readiness-weights editor). UI-078: /mentor/talent-pool route (static sibling registered before /mentor/:applicantUserId) → TalentPoolPage (full ranked talent pool) inside MentorWorkspaceLayout. UI-081: /admin/milestone-awards route → MilestoneAwardsAdminPage (admin audit view for milestone_award table). UI-101: /admin/flags route → FlagsAdminPage (admin flag review view), gated by AdminLayout like the other /admin sub-routes. UI-103: /settings route → AccountSettingsPage (change password, active sessions, delete account) — direct child of ProtectedLayout, not nested under ApplicantLayout.
│       ├── main.tsx            # process entry: QueryClientProvider + RouterProvider
│       ├── index.css           # Tailwind 4 @theme tokens: primary/warning/success/danger/focus ramps (Phase 3 + Phase 7); OSU orange primary ramp, warm-neutral surface/ink tokens, pending-amber warning ramp, success/pending status tokens, Hanken Grotesk + Bricolage Grotesque font tokens, body default + .numeral utility (PM032)
│       ├── api-types.ts        # generated from OpenAPI spec; sole API contract for the UI
│       ├── lib/
│       │   ├── apiFetch.ts          # Shared fetch wrapper — the single UI→API fetch seam (UI-093). apiFetch<T>(url, opts?) always sends credentials:'include' (caller opts spread after, may override other fields); on non-2xx throws an Error instance carrying { status:number, body:unknown } — the exact shape queryClient.ts inspects for 401 re-auth, now guaranteed structurally at one throw site; returns undefined as T for 204 responses. Every hook queryFn/mutationFn calls this instead of raw fetch.
│       │   ├── queryClient.ts       # QueryClient with 401 → re-auth dispatch (Phase 3, UI-002)
│       │   ├── queryKeys.ts         # central React Query key registry (Phase 7, UI-008); mentorGrants + userSearch keys added Phase 8 (UI-018); myMentorGrants key added Phase 8 (UI-020); userList key added UI-031; pendingGrants key added UI-035 (key: ['mentorGrants', 'pending'] — sub-key of mentorGrants scope, invalidated together with mentorGrants on approve/reject); myApplicantGrants key added UI-034 (key: ['myApplicantGrants'] — applicant's own grant records, queried by MentorStatusPage to show pending/active mentor state); mentorImpact key added UI-072 (key: ['mentorImpact'] — used by useMentorImpact); readinessConfig key added UI-076 (key: ['readinessConfig'] — used by useReadinessConfig / useUpdateReadinessConfig); talentPool key added UI-078 (key: ['talentPool'] — used by useTalentPool); myMilestones key added UI-080 (key: ['myMilestones'] — used by useMyMilestones; invalidated in useCreateExperience/useUpdateExperience/useVerifyExperience onSuccess so a new server award surfaces after add/edit/verify); myProfile key added API-047 (key: ['myProfile'] — used by useMyProfile / useUpdateMyProfile); myHeadshot key added UI-108 (key: ['myHeadshot'] — used by useMyHeadshot; invalidated in useUploadHeadshot onSuccess alongside myProfile so the new photo loads); applicantProfile key added UI-096 (key: ['applicantProfile', applicantUserId] — per-applicant, used by useApplicantProfile for the mentor-scoped review profile card). myResume key added UI-109 (key: ['myResume'] — used by useMyResume; invalidated in useUploadResume/useDeleteResume onSuccess); applicantResume key added UI-109 (key: ['applicantResume', applicantUserId] — per-applicant, used by useApplicantResume for the mentor-scoped resume link). NOTE: adminFlags key (['adminFlags', 'open'|'all']) is page-local in FlagsAdminPage.tsx by design — no cross-page invalidation requirement; not registered in this file (UI-101, PM048-main)
│       │   ├── goals.ts             # Per-category goal-hours derivation. As of PM036 (UI-077) the goal helpers take an operator-editable goalHours value (number | null) read off each fetched category (experience_categories.goal_hours, API-041) — NOT keyed off the legacy slug→threshold map. Exports goalMet(goal, hours) (false for null goals), goalPercent(goal, hours) (Math.min(100, round(hours/goal*100)); null for null/zero goals), exceededBy(goal, hours) (hours-goal when over a non-null goal, else null), and goalFraction(goal, hours) (min(1, hours/goal) for a goal-bearing category, null when excluded — the per-category readiness goalProgress contribution). GOAL_HOURS (Record<string, number | null>) and goalForSlug(slug) are retained as the display source for RisingCandidatesCard's talent-pool readiness computation. `null` = "no hour minimum" (employment, extracurricular-activities), distinct from a 0-hour goal. UI-065, UI-077.
│       │   ├── initials.ts          # Shared display-name → uppercase initials helper. getInitials(name): string — multi-word → first+last word initials; single-word → first char; empty/whitespace → '?'. Replaces five inline copies. UI-094.
│       │   ├── readiness.ts         # Client-side readiness derivation (PM034; not persisted). Exports ReadinessWeights / ReadinessInput interfaces (activeCategories carry { id, goalHours }), DEFAULT_READINESS_WEIGHTS ({wGoal:0.6, wVerified:0.25, wBreadth:0.15} — key names match the PM036 readiness-config contract, DB-025/API-042, mapping 1:1), and computeReadiness(input, weights = DEFAULT_READINESS_WEIGHTS): number → integer in [0,100] from goalProgress (mean of goalFraction over active categories whose goalHours is non-null), verifiedRatio (verified/max(1,total)), and breadth (populated active categories / max(1, active)). weights is an explicit param — the PM036 operator-config seam (never bundled into CRUD payloads). Reads each category's goalHours directly off the category objects (via goalFraction from goals.ts) — no longer via goalForSlug. The readiness consumers (HomePage, ApplicantReviewPage) call useReadinessConfig() once and pass data ?? DEFAULT_READINESS_WEIGHTS. UI-066, UI-077.
│       │   ├── milestones.ts        # STRUCTURAL milestone display metadata + types for the PM034 dashboard (Decision 3). API-064 removed the hour-threshold mirror: hour milestones are operator-configured server-side (milestone_config) and arrive fully evaluated via GET /api/me/milestones (useMyMilestones) — the client no longer re-derives them (supersedes ADR-041 for hour milestones). Exports MilestoneCtx, MilestoneResult ({key, label, earned, remainingLabel}), the MILESTONES definition list (structural only: first experience; first verified; all verified; 1/2/all goal categories met; 3+ categories breadth — NO hours-* entries), and evaluateMilestones(ctx) → MilestoneResult[] (retained as structural display metadata; authoritative earned state for all milestones comes from the API). "all verified" / "all goals met" are locked when their total is 0 (not vacuously earned). UI-067, API-064.
│       │   └── mentorLevel.ts       # Pure functions and threshold constants for mentor level derivation. `PLATINUM_HOURS = 1000` — backward-compat default export. `mentorLevel(lifetimeHours, platinumHours = 1000) → 'Gold' | 'Platinum'` (UI-072). `hoursToNextLevel(lifetimeHours, platinumHours = 1000) → number | null` — returns `Math.max(0, platinumHours - lifetimeHours)` below threshold, `null` at/above Platinum (UI-082). Both functions accept an optional `platinumHours` param so call sites pass the operator-configured value from `useReadinessConfig()` — API-063.
│       ├── layouts/
│       │   ├── ProtectedLayout.tsx  # session gate: no-session → /sign-in; unenrolled → /enrol; mounts a persistent app header (brand link "asp" → /; role-aware nav: admins → /admin + /experiences, applicant/mentor → /experiences; plus a sign-out button — UI-028, UI-040) above the ApplicantPicker top bar (UI-020). UI-097: conditionally renders a "Mentor workspace" link → /mentor for any user where useMe().hasMentorGrants is true (admin or not), after the Admin/Experiences links — grant holders get a nav path to the workspace instead of typing the URL. In the PM034+ navigation IA, the persistent header's "Experiences" link for non-admin users coexists with the ApplicantLayout BottomTabBar; the header is the legacy top nav, BottomTabBar is the primary applicant nav. UI-103: persistent header always includes an "Account settings" link → /settings (after the Mentor workspace link when present) for all authenticated users. UI-105: renders <NotificationBell /> in the header adjacent to the sign-out button.
│       │   ├── ApplicantLayout.tsx  # applicant app-shell: scrolling <Outlet /> in a centered max-w-[640px] column on bg-app-bg above a fixed BottomTabBar. Wraps /home, /experiences, /mentor-status, /profile. UI-063 (mentor-status route renamed from /mentor in UI-071).
│       │   ├── MentorWorkspaceLayout.tsx  # B1 mentor desktop workspace shell (UI-071): fixed 226px dark sidebar (bg-ink) with "O" brand placeholder (D9) + nav (Dashboard NavLink → /mentor end, Talent pool NavLink → /mentor/talent-pool — UI-098) + bottom level-card slot (data-testid mentor-level-card) rendering <MentorLevelBadge /> (UI-082, D6); 64px white top bar (bg-card, hairline border); bg-app-bg <main> with <Outlet />. Collapses to a 64px icon rail below 900px (max-[900px]: utilities). Unimplemented items (My applicants, Verification queue, Reports) are hidden entirely until their feature phases ship. Root of /mentor.
│       │   ├── AdminLayout.tsx      # RBAC gate: non-admin → /experiences; wraps /admin sub-routes
│       │   └── MentorScopeLayout.tsx    # ABAC scope gate: asserts active grant; provides MentorContext. UI-021.
│       ├── hooks/
│       │   ├── useAnimatedNumber.ts  # useAnimatedNumber(target, durationMs?=600): number — rAF count-up from 0 to target on mount (ease-out cubic), restarts when target/durationMs change, settles exactly on target. Source for the readiness ring's 0→value animation (UI-064). UI-066.
│       │   ├── useGoalCrossing.ts    # useGoalCrossing(userId: string | undefined, metSlugs: string[]): { crossed: string | null, dismiss: () => void } — client-debounced goal-crossing detector. Compares the current met-slug set against a localStorage baseline keyed by userId (`asp:goal-met:<userId>`). Surfaces the first newly-crossed slug as `crossed`; records it into the baseline immediately so it fires exactly once (debounced — does not re-fire on re-render or reload). On first observation (no stored baseline), seeds the baseline with the current met set and returns `crossed: null` (no false celebration on login). PM038 seam: replace the localStorage baseline with a server-confirmed newly-awarded milestone_award row. UI-069.
│       │   ├── useGoalCrossing.test.ts  # Debounce-contract unit tests (TEST-050). Asserts: first observation seeds baseline silently (crossed: null); newly-crossed slug surfaces exactly once; re-render with same set after dismiss() returns null; crossed slug is recorded into localStorage immediately; simulated reload does not re-fire when slug is already in baseline. Uses renderHook + act from @testing-library/react; clears localStorage in beforeEach.
│       │   ├── useCurrentUserId.ts  # reads userId from ['session'] cache
│       │   ├── useMe.ts             # GET /api/me → MeResponse (roles, hasMentorGrants)
│       │   ├── useCategories.ts     # GET /api/experience-categories, queryKey queryKeys.categories
│       │   ├── useCreateCategory.ts # POST /api/experience-categories; invalidates queryKeys.categories
│       │   ├── useUpdateCategory.ts # PATCH /api/experience-categories/:id; invalidates queryKeys.categories
│       │   ├── useExperiences.ts    # GET /api/experiences?owner_user_id=
│       │   ├── useRollup.ts         # GET /api/experiences/rollup?owner_user_id=
│       │   ├── useCreateExperience.ts
│       │   ├── useUpdateExperience.ts
│       │   ├── useDeleteExperience.ts
│       │   ├── useVerifyExperience.ts  # PATCH /api/experiences/:id/verification with { action: 'verify' | 'unverify' }; invalidates experiences + rollup for ownerUserId. UI-037.
│       │   ├── useUserSearch.ts     # GET /api/users?email= via TanStack Query; queryKey queryKeys.userSearch(email). UI-018.
│       │   ├── useMentorGrants.ts   # GET /api/mentor-grants; queryKey queryKeys.mentorGrants. UI-018.
│       │   ├── useCreateMentorGrant.ts  # POST /api/mentor-grants; invalidates queryKeys.mentorGrants. UI-018.
│       │   ├── useRevokeMentorGrant.ts  # PATCH /api/mentor-grants/:id with { status: 'revoked' }; invalidates queryKeys.mentorGrants. UI-019.
│       │   ├── useMyMentorGrants.ts     # GET /api/mentor-grants/mine; queryKey queryKeys.myMentorGrants; used by ApplicantPicker. UI-020.
│       │   ├── useMentorGrant.ts        # finds grant for a given applicantUserId from useMyMentorGrants(). UI-021.
│       │   ├── useMyApplicantGrants.ts  # GET /api/mentor-grants/my-requests; queryKey queryKeys.myApplicantGrants; used by MentorStatusPage to show applicant's own grant state. UI-034. (Note: PM026-main initially wired to admin-only endpoint — fixed in PM026-post1 API-036.)
│       │   ├── useMentorImpact.ts       # GET /api/mentor/impact; queryKey queryKeys.mentorImpact; typed from paths['/api/mentor/impact']['get']['responses'][200]['content']['application/json']. UI-072.
│       │   ├── useReadinessConfig.ts     # GET /api/readiness-config; queryKey queryKeys.readinessConfig; staleTime Infinity (config fetched once, D1); typed from paths['/api/readiness-config']. Shared with UI-077. UI-076.
│       │   ├── useUpdateReadinessConfig.ts  # PUT /api/admin/readiness-config { wGoal, wVerified, wBreadth }; invalidates queryKeys.readinessConfig on success. UI-076.
│       │   ├── useTalentPool.ts         # GET /api/mentor/talent-pool; queryKey queryKeys.talentPool; typed from paths['/api/mentor/talent-pool']; exports TalentPool / TalentPoolEntry types. Raw readiness components only — client computes + ranks (D1). UI-078.
│       │   ├── useMyMilestones.ts       # GET /api/me/milestones; queryKey queryKeys.myMilestones; returns MilestoneView[] ({ key, label, earned, earnedAt, remainingLabel }) from the stored milestone_award rows — the server-confirmed source for the HomePage milestone strip. UI-080.
│       │   ├── useCreateFlag.ts         # POST /api/experiences/:id/flag mutation with { reason }; typed from paths['/api/experiences/{id}/flag']; no query invalidation (the reviewer has no flag list view — the admin queue at /admin/flags fetches independently). Used by the ApplicantReviewPage flag modal. UI-101.
│       │   ├── useApplicantProfile.ts   # useApplicantProfile(applicantUserId) — GET /api/mentor/applicants/:id/profile; queryKey queryKeys.applicantProfile(applicantUserId); typed from paths['/api/mentor/applicants/{id}/profile'] and re-exported as ApplicantProfile; returns the mentor-visible subset { name, school, graduationYear, bio, major, linkedinUrl, portfolioUrl } (no phone/gpa per API-057). Disabled for empty id; exposes isLoading/isError so the review page renders gracefully on a denied/failed request. UI-096.
│       │   ├── useMyProfile.ts          # GET /api/me/profile; queryKey queryKeys.myProfile; typed from `paths['/api/me/profile']['get']['responses'][200]['content']['application/json']` (api-types.ts) and re-exported as MyProfile; returns { name, email, school, graduationYear, bio, major, gpa, phone, linkedinUrl, portfolioUrl }. API-047; typing resolved + new fields UI-095. UI-108 co-locates two headshot hooks here: useMyHeadshot() — GET /api/me/headshot, queryKey queryKeys.myHeadshot, resolves to { url } on 200 and to null on 404 (no headshot set is NOT an error — retry:false, the 404 is swallowed in queryFn; other non-2xx still throw so the 401 → re-auth path fires); useUploadHeadshot() — POST /api/me/headshot mutation sending the raw File as multipart/form-data under field `file` (no Content-Type header so the browser sets the multipart boundary), typed error carries status (413/415), on success invalidates queryKeys.myHeadshot + queryKeys.myProfile.
│       │   ├── useResume.ts             # Resume hooks (UI-109). useMyResume() — GET /api/me/resume, queryKey queryKeys.myResume, resolves to { url } on 200 and to null on 404 (no resume is NOT an error — retry:false, 403/401/500 still throw); useUploadResume() — POST /api/me/resume mutation, multipart FormData under field `file`, typed error carries status (413/415), on success invalidates queryKeys.myResume; useDeleteResume() — DELETE /api/me/resume mutation, on success invalidates queryKeys.myResume; useApplicantResume(applicantUserId) — GET /api/mentor/applicants/:id/resume, queryKey queryKeys.applicantResume(applicantUserId), resolves to { url } on 200 and to null on 404 or 403 (grant enforcement is server-side; the UI simply omits the link), disabled for empty id, retry:false.
│       │   ├── useUpdateMyProfile.ts    # PATCH /api/me/profile mutation; body typed as UpdateMyProfileBody = paths['/api/me/profile']['patch']['requestBody'] ({ name?, school?, graduationYear?, bio?, major?, gpa?, phone?, linkedinUrl?, portfolioUrl? }); on success invalidates queryKeys.myProfile + queryKeys.me. API-047; typing resolved + new fields UI-095.
│       │   ├── useMilestoneAward.ts     # useMilestoneAward(userId, earnedKeys: string[]): { awarded: string | null, dismiss: () => void } — exactly-once, server-confirmed celebration detector. Fires the first server-earned key not yet in the per-user localStorage baseline (asp:ms-awarded:<userId>); first observation seeds silently (no false fire); the baseline is append-only (union, never shrunk — a transient/loading empty earned set cannot re-fire an acknowledged key). Replaces the UI-069 useGoalCrossing celebration trigger. UI-080.
│       │   └── useVerificationQueue.ts  # Client-side mentor verification queue (UI-073): reads useMyMentorGrants for active grants, fans out per-applicant via useQueries over /api/experiences?owner_user_id=, flattens to QueueRow[] (experience + applicantName + applicantUserId) filtered to verificationStatus === 'unverified'. Exposes isLoading, rows, pendingCount.
│       ├── forms/
│       │   └── experienceFormSchema.ts  # hand-written Zod schema (date fields as strings; optional <select> fields use z.preprocess to coerce empty-string → undefined before enum validation); single .superRefine() validates hours triple and date ordering (endDate > startDate when isCurrent is false and endDate is non-null — UI-099)
│       ├── components/
│       │   ├── ApplicantPicker.tsx         # top-bar mentor applicant selector; visible only when hasMentorGrants; select is wrapped in a visually-present label "View as applicant" for accessibility. UI-020, UI-041.
│       │   ├── ExperienceDetailFlyout.tsx  # A4 mobile-full-screen / right-drawer flyout (UI-061): org/position title block + ProvenanceChip (verified → success-bg, unverified → pending-bg); 3-up hours stat row; Duties, Location, Attestations (chips), Verifying Contact sections. VerifyButton gated on write-permission mentor context — renders only when `mentorCtx` is non-null AND `mentorCtx.grant.permissions.includes('write')`; a read-only grant sees no button (PATCH /api/experiences/:id/verification). UI-036 (CER-018), UI-037, UI-047, UI-061. VerificationBadge remains exported for backward compatibility; ProvenanceChip is the internal inline badge used in the flyout header.
│       │   ├── ExperienceForm.tsx          # create/edit 3-step sheet (Basics / Hours & dates / Details); sticky header with Cancel + Save; step progress bar + category chip; attestations as iOS toggles; all RHF+Zod logic and HoursTriple invocation frozen from Phase PM026. UI-059, UI-062. Step 0 frequency select includes help text explaining VMCAS vocabulary (UI-099). Contact fieldset includes a consent-visibility notice at the top (UI-099).
│       │   ├── DutiesEditor.tsx            # textarea with live N/8192 char count
│       │   ├── HoursTriple.tsx             # last-edited-two-win hours coupling; orange `border-primary-500` on user-entered inputs, dashed `border-dashed border-[color:var(--color-dashed)]` + `· auto` label on the derived input; `data-testid="hours-{field}"` + `data-auto="true"` on the derived field. UI-060.
│       │   ├── MentorBanner.tsx            # sticky top banner shown in MentorScopeLayout; "Viewing on behalf of…" + exit button. UI-022.
│       │   ├── Modal.tsx                   # shared modal wrapper: overlay + centered panel + Escape-to-close + backdrop-click-to-close; role="dialog" aria-modal; used by CategoryPage create/edit form. UI-045.
│       │   ├── BottomTabBar.tsx            # fixed bottom nav of four NavLinks (Home /home, Categories /experiences, Mentor /mentor-status, Profile /profile); inline 2px-stroke SVG icon + label per tab; active tab text-primary-500, inactive text-muted. UI-063 (Mentor tab repointed from /mentor to /mentor-status in UI-071).
│       │   ├── RequestMentorModal.tsx      # controlled modal: email input + POST /api/mentor-grants/requests; always receives 201 { message: 'Request sent' } (anti-enumeration — API-050); shows a single success message regardless of outcome. UI-034.
│       │   ├── MilestoneStrip.tsx          # renders evaluateMilestones(ctx) results as a wrap of pill badges; props: { milestones: MilestoneResult[] }. Earned = solid bg-primary-500 + white check SVG; locked = bg-card with dashed border-[--color-dashed], text-muted, "<label> · <remainingLabel>" copy. UI-067.
│       │   ├── HomeEmptyState.tsx          # first-run empty state for HomePage; props: { name: string; categories: { id: string; name: string; goalHours: number | null }[]; isAdmin?: boolean }. Two branches: isAdmin=false (default) — renders a brand row + "Welcome, {name}" greeting; a bg-ink hero with a 64px orange-tint "+" tile, the headline "Your portfolio starts empty. It won't stay that way.", and a full-width orange "Add your first experience" CTA (navigates to /experiences); a "How it works" 1-2-3 numbered-disc list; and a "Your categories" dashed-border preview row per active category showing "0 of <goal> hr goal" (goal-bearing) or "No hour minimum" (null goal), each with a "+" button that also navigates to /experiences. isAdmin=true — hero card, "How it works", and category "+" buttons suppressed; renders an "Admin account" card with a link to /admin instead. UI-068, UI-085.
│       │   ├── VerificationQueueCard.tsx   # B1 mentor verification queue card for MentorDashboardPage (UI-073): header with "N waiting" pill; green "N of M cleared today" progress bar (session-local counter, no persistence); one row per unverified experience (avatar initials, Name·Org, category·hrs·position, orange Verify button); optimistic dimmed green-check "+N hrs" treatment on Verify; error revert with inline message; "All caught up" empty state. Uses useVerificationQueue, useVerifyExperience (per QueueRowItem sub-component), useCategories.
│       │   ├── RisingCandidatesCard.tsx   # B1 "Rising candidates" ranked card (UI-078): reads useTalentPool + useReadinessConfig, maps each entry to a readiness.ts ReadinessInput (goalHours via goalForSlug per category slug — the talent-pool response carries none), ranks DESCENDING by computeReadiness (ties by applicantName), renders top 5 rows (rank numeral, initials avatar, name, bg-track/primary-500 readiness bar, bold %); #1 row bg-primary-50 highlight + filled star (data-testid rising-star-filled), others outline star; "View full talent pool" Link → /mentor/talent-pool; loading skeleton + "No candidates yet" empty state. Exports rankTalentPool(entries, weights) reused by TalentPoolPage.
│       │   ├── CelebrationOverlay.tsx      # A5 full-screen celebration modal. Props: { categoryName: string; onShare: () => void; onKeepBuilding: () => void }. Renders: dark radial background (inline style `radial-gradient(120% 80% at 50% 12%, #2A1C0E, #14110F)`), scattered confetti chips (static positions, no animation), a centered medallion (orange disc + white check SVG), an orange "GOAL REACHED" eyebrow, a Bricolage headline ("You hit your {categoryName} goal!"), support copy naming the category, and two CTAs — "Share progress with my mentor" (calls onShare; caller wires navigate('/mentor-status') inside it) and "Keep building" (calls onKeepBuilding). Both CTAs call the hook's dismiss() via their respective callbacks. NOTE: confetti chip backgroundColor fields and radial-gradient stops use raw hex literals — a known ideology exception (spec-allowed; gradient background colors #2A1C0E/#14110F have no current token; confetti colors have Tailwind equivalents). A future phase should mint @theme tokens and replace inline hex. UI-069.
│       │   ├── MentorLevelBadge.tsx       # Private mentor level badge (D6, UI-082): calls useMentorImpact() + useReadinessConfig(); derives level via mentorLevel(lifetimeHoursVerified, platinumHours ?? 1000) and remaining via hoursToNextLevel(lifetimeHoursVerified, platinumHours ?? 1000); renders level name (Gold mentor / Platinum mentor), lifetimeHoursVerified (tabular-nums), and either a "N hrs to Platinum" progress line or a "Top tier" label. No leaderboard/rank/percentile text. Handles isLoading (placeholder) and undefined data (null). PM032 tokens only — no hardcoded hex. API-063 wired platinumHours from config.
│       │   ├── BackupCodesBlock.tsx       # Shared one-time backup-codes display block (UI-104). Props: { codes: string[] }. Renders each code as a monospace list item; a "Copy to clipboard" button writes codes.join('\n') to navigator.clipboard with a "Copied!" confirmation state; a prominent warning ("shown only once — save securely"). Does NOT persist codes — caller is responsible for never persisting them. Used by TotpEnrol (post-enable display) and AccountSettingsPage BackupCodesSection (post-regeneration display).
│       │   └── NotificationBell.tsx       # Client-side notification bell + dropdown (UI-105). Reads useCurrentUserId + useExperiences(userId); computes notifications as experiences whose verificationStatus is 'verified' and whose effective timestamp (verifiedAt ?? updatedAt) is later than the per-user ack timestamp stored in localStorage under `asp:notifications:ack:<userId>`. Bell icon button in ProtectedLayout header; badge shows unacknowledged count (hidden when zero; display capped at "9+"). Clicking the bell opens a dropdown listing the most recent 10 notifications (organization, position, relative time). "Mark all read" button sets ack to now and clears the badge. State is per-user — switching accounts cannot leak ack state. Phase-1 approximation: detection only while the app is open; no server push. Zero hex literals and zero inline style props — Tailwind theme tokens only.
│       ├── pages/
│       │   ├── SignUp.tsx
│       │   ├── SignIn.tsx             # sign-in form; on success reads BA response body — if twoFactorRedirect: true, navigates to /two-factor for the TOTP challenge (TotpChallenge, code-only; UI-090); otherwise navigates to /
│       │   ├── ForgotPassword.tsx         # /forgot-password — request password reset; useMutation POST /api/auth/request-password-reset; always shows success message (anti-enumeration). UI-023.
│       │   ├── ResetPassword.tsx          # /reset-password — set new password via token; react-hook-form + Zod refine for password match; useMutation POST /api/auth/reset-password; onSuccess navigates to /sign-in with state.message; onError shows expired-link inline error. UI-024.
│       │   ├── TotpEnrol.tsx              # /enrol — enrolment-only screen reached from sign-up; calls BA two-factor/enable on mount, renders QR code + raw base32 secret (data-testid="totp-secret", "Can't scan?" copy, selectable monospace) for manual-entry fallback, then verify-totp on submit → navigate('/'). UI-091. UI-104: if the enable response contains backupCodes (string[]), renders BackupCodesBlock below the QR section before the verify form — codes are shown exactly once and not persisted anywhere; the verify button is below the block. Challenge traffic (returning users mid-sign-in) routed to /two-factor (TotpChallenge) — do not merge flows.
│       │   ├── TotpChallenge.tsx          # /two-factor — code-only TOTP challenge for already-enrolled users mid-sign-in (UI-090); posts verify-totp only — no enable call, no QR. SignIn.tsx routes twoFactorRedirect here so a returning user sees no error until a bad code is submitted.
│       │   ├── HomePage.tsx               # /home — applicant dashboard landing. Placeholder body in UI-063; populated dashboard authored in UI-064. UI-068 adds an empty-state branch: when experiences have loaded (isSuccess) and experiences.length === 0, renders HomeEmptyState instead of the populated dashboard, avoiding a flash during load. UI-080: the milestone strip renders from the server via useMyMilestones (GET /api/me/milestones, stored milestone_award rows) — the client-derived evaluateMilestones(ctx) call was removed from HomePage; celebration is now server-confirmed via useMilestoneAward(userId, earnedKeys) (earnedKeys = the server-earned milestone keys), mounting CelebrationOverlay when awarded !== null with the awarded milestone's label as the copy; "Share progress" navigates to /mentor-status, "Keep building" calls dismiss() (replacing the UI-069 useGoalCrossing/metSlugs trigger).
│       │   ├── HomePage.derivation.test.tsx  # Integration derivation tests (TEST-050). Renders HomePage inside QueryClientProvider + MemoryRouter with seeded cache data; mocks useAnimatedNumber to return target directly; stubs fetch (/api/me/milestones routed to a MilestoneView[] fixture). Asserts: readiness hero numeral equals computeReadiness for seeded rollup/experiences/categories; 3-up stats match derived totalHours/verifiedCount/experienceCount; goals-met pill reflects goalMet over goal-bearing categories; CelebrationOverlay mounts exactly once when the server confirms a newly-awarded milestone (asp:ms-awarded baseline pre-seeded to exclude the new server-earned key), naming that milestone's label (UI-080 replaced the UI-069 goal-freshly-crossed localStorage-baseline case).
│       │   ├── ProfilePage.tsx            # /profile — applicant profile edit form (UI-088; new fields UI-095). Controlled form with name, school, major, graduationYear, phone, linkedinUrl, portfolioUrl, bio fields; reads from GET /api/me/profile via useMyProfile(); writes via PATCH /api/me/profile via useUpdateMyProfile(). Per-field Zod validation (major ≤128; phone E.164 `^\+[1-9]\d{1,14}$` with a "Format: +15555550100" hint; linkedinUrl/portfolioUrl must start with `https?://` ≤256 — matches the server-side scheme restriction, API-066) — each field is optional (empty allowed) but a non-empty invalid value blocks submit with a human-readable message. No GPA edit field by design (privacy-sensitive; not surfaced to mentors — see UI-095 Context). All error/status text uses theme tokens only (text-danger-700 / text-success-700 — no text-red-* per ideology). Shows "Profile saved." on success; the banner auto-dismisses after 3000 ms via a useEffect that calls the mutation's reset() — the timeout is cancelled on unmount or re-fire so no stale state update can occur (UI-100). Shows error message on failure. Populated by useEffect when profile data loads. UI-108 adds a headshot block above the form: a round avatar rendering the pre-signed image from useMyHeadshot() when present, falling back to the getInitials(name) initials avatar on 404 (the no-photo case is not an error state); a hidden file input (accept="image/jpeg,image/png,image/webp") triggered by an "Upload photo" button; on selection useUploadHeadshot() POSTs the file as multipart, with an "Uploading…" overlay/disabled-button pending indicator, a client-side fail-fast when file.size > 5 MB, and a transient role="alert" error message (auto-dismissed after 4000 ms) mapping server 413 → "Image too large — max 5 MB" and 415 → "Unsupported image type" (text-danger-700 token). UI-109 adds a resume block between the headshot block and the profile form: empty state (GET /api/me/resume → 404) shows a hidden file input (accept=".pdf") plus an "Upload resume (PDF)" button; on selection useUploadResume() POSTs multipart with client-side fail-fast at 10 MB (toast "Max 10 MB"), server 413 → "Max 10 MB" and 415 → "PDF only" toasts (role="alert", auto-dismissed 4000 ms); uploaded state (GET → 200) shows "Resume uploaded", a "View" link opening the pre-signed URL in a new tab, and a "Remove" button that calls window.confirm() then useDeleteResume() on confirmation.
│       │   ├── MentorStatusPage.tsx       # /mentor-status — applicant mentor-grant status (no grant → "Request a mentor" via RequestMentorModal; pending → pending message + mentor email; active → enriched mentor card: an initials disc (bg-ink, mentorInitials() from mentorName), mentor name (or email fallback), mentor email, a "Connected since {grantedAt formatted date}" line, and a "Your experiences →" CTA button navigating to /experiences — UI-087) via useMyApplicantGrants + useMe (admins gated out). Guards against loading flash — while useMyApplicantGrants() is pending (grantsLoading), renders only the page heading without the empty-state copy or "Request a mentor" button (UI-097). No mentor-scope/verify control. Extracted from ExperiencesPage in UI-063; route renamed from /mentor in UI-071 (the /mentor namespace now hosts the mentor workspace).
│       │   ├── MentorDashboardPage.tsx     # /mentor index — mentor workspace dashboard. UI-071 scaffold; UI-072 populates mentor-impact-region with: ink-background impact hero (eyebrow "YOUR IMPACT THIS MONTH", monthHoursVerified Bricolage numeral, two glass tiles — streakDays and mentorLevel(lifetimeHoursVerified)); 4-up stat grid (applicantsMentored, pendingVerifications with primary/orange accent, avgTurnaroundHours (— when null), lifetimeHoursVerified). UI-073 populates mentor-queue-region with VerificationQueueCard.
│       │   ├── ExperiencesPage.tsx        # category tab bar; URL-driven active tab. In mentor scope (mentorCtx non-null), renders a context heading "Experiences — {applicantName}" above the tab bar for in-body identity context. UI-041. Applicant mentor-status section moved to MentorStatusPage in UI-063. UI-107: on the applicant's own view only (mentorCtx null), renders a "Download CSV" button above the tab bar that calls window.open('/api/experiences/export?owner_user_id=' + currentUserId) — session-cookie + Content-Disposition download (API-062). Mentor-view export deferred to API-063 (mentor ABAC widening of the export endpoint).
│       │   ├── CategoryPage.tsx           # stacked card list per category (one data-testid="experience-card" per experience); near-black category hero (bg-ink) with the rollup totalHours numeral + display-only progress bar (fillPct=100 placeholder — real goal-tracking in CategoryPage deferred to PM036; goals.ts now available via UI-065); a "{n} experiences" + "{v} verified · {p} pending" count row (counts derived client-side); per-card status chip (local StatusChip: Verified/Pending) + stat chips (hours-below-threshold preserved on the hours chip); tapping a card opens ExperienceDetailFlyout; create/edit/delete modal uses shared Modal component (UI-045); an orange "+ Add" FAB (fixed bottom-right) replaces the top-right Add button. UI-057 supersedes the UI-044/UI-049 table wiring: the DutiesFlyout/dutiesId path and the per-row VerificationBadge were removed (duties now live in the detail view per A4 / UI-061)
│       │   ├── ApplicantReviewPage.tsx    # /mentor/:applicantUserId (index) — B2 mentor-scoped applicant review + verify screen (UI-074). Left panel: 64px avatar (initials), applicant name, a Profile card (UI-096, below the avatar block; via useApplicantProfile — school, major, graduation year, bio, and linkedinUrl/portfolioUrl rendered as new-tab rel="noopener noreferrer" links; null/empty fields omitted, "No profile information provided" when all fields null; no phone/GPA by design per API-057), 120px ProgressRing (computeReadiness), hours-by-category mini bars (useRollup). Verify-progress banner (bg-ink): "Almost there — X of Y verified", readiness-lift hint, progress bar. Per-category sections: pending rows (orange border-primary-500 card, Flag button, ✓ Verify button calling useVerifyExperience mutate({ id, action: 'verify' })); verified rows (white bg-card, "Verified by you · {date}"). Reads applicantUserId + applicantName from useMentorContext(); falls back to :applicantUserId param. UI-101: the Flag button opens a flag modal (shared Modal wrapper; reason textarea + "Submit flag") posting via useCreateFlag; success and error states shown inline in the modal. UI-102: search input + All/Unverified/Verified status toggle above the experience list — pure client-side filtering over the useExperiences() result (case-insensitive substring match on organization/position/dutiesNarrative, AND-combined with the status filter); category grouping preserved for the filtered set, empty categories hidden; banner counts remain unfiltered totals. UI-109: ProfileCard now includes a resume row when useApplicantResume(applicantUserId) resolves to a non-null URL (GET /api/mentor/applicants/:id/resume → 200); renders "View resume" as a new-tab anchor (target="_blank" rel="noopener noreferrer"); 404 → null (omitted, not an error), 403 → null (grant enforcement is server-side, panel simply omits the link); no error state for missing resume.
│       │   ├── TalentPoolPage.tsx         # /mentor/talent-pool (static sibling before :applicantUserId) — full ranked talent pool (all granted applicants) via useTalentPool + rankTalentPool (readiness ranking shared with RisingCandidatesCard); #1 row bg-primary-50 highlight; loading skeleton + "No candidates yet" empty state. UI-078.
│       │   ├── AdminPage.tsx              # /admin index — card-based admin landing page linking to Categories, Grants, Users (UI-029, UI-033), Readiness, Milestone awards, and Flags (UI-101)
│       │   ├── CategoriesAdminPage.tsx    # /admin/categories — category CRUD (list/create/edit/deactivate)
│       │   ├── GrantsAdminPage.tsx        # /admin/grants — mentor grant creation + list; user search via useUserSearch. UI-018. Pending requests section (approve/reject applicant-initiated requests) added UI-035: fetches GET /api/mentor-grants?status=pending (queryKey pendingGrants), renders above the grants table only when pending exist, approve PATCH → active, reject PATCH → revoked, both invalidate pendingGrants + mentorGrants.
│       │   ├── ReadinessSettingsPage.tsx  # /admin/settings — admin readiness-weights editor (named management surface for readiness_config). Three numeric inputs (Goal progress/Verified ratio/Breadth → wGoal/wVerified/wBreadth) pre-filled via useReadinessConfig; live sum (tabular-nums) with inline hint; Save disabled (button + message) unless each weight ∈ [0,1] and sum within ±0.001 of 1; submit via useUpdateReadinessConfig. UI-076.
│       │   ├── MilestoneAwardsAdminPage.tsx  # /admin/milestone-awards — admin audit view for milestone_award table (management surface per conceptual-rebuild-completeness rule, UI-081). Read-only table: User (email or userId fallback), Milestone (milestoneKey), Earned (earnedAt date). Fetches GET /api/admin/milestone-awards with credentials: 'include'; loading / error / empty states mirror UsersAdminPage pattern.
│       │   ├── FlagsAdminPage.tsx         # /admin/flags — admin flag review view (management surface for flag_report, UI-101). Reads GET /api/admin/flags?status=open by default with a "Show all statuses" toggle (page-local ['adminFlags', 'open'|'all'] query keys via apiFetch); table columns Experience (org · position), Applicant (ownerUserId), Flagged by (reviewerName/email fallback), Reason, Date, Status; "Mark resolved" on open flags fires PATCH /api/admin/flags/:id (API-059) and invalidates the list.
│       │   ├── AccountSettingsPage.tsx    # /settings — account management for all authenticated users (UI-103). Four sections: (1) ChangePasswordSection — POST /api/auth/change-password; (2) ActiveSessionsSection — GET /api/auth/list-sessions + DELETE /api/auth/revoke-session + DELETE /api/auth/revoke-all-other-sessions; (3) BackupCodesSection — displays current code count as "Unknown" (BA 1.6.11 has no public read endpoint for the count; viewBackupCodes is an internal helper with no HTTP path); "Regenerate backup codes" opens an inline password-prompt form that POSTs /api/auth/two-factor/generate-backup-codes (BA 1.6.11 endpoint; body: { password }; returns { status, backupCodes }); on success renders BackupCodesBlock one-time; (4) DeleteAccountSection — DELETE /api/auth/delete-user + sign-out + navigate to /sign-in. UI-104.
│       │   └── UsersAdminPage.tsx         # /admin/users — paginated user list (email/name/roles/active-grant-count) with Prev/Next; reads GET /api/users?page=N&pageSize=20 (API-029). UI-031.
│       └── test/setup.ts
├── e2e/                        # Playwright E2E tests (testDir in playwright.config.ts)
│   ├── auth.spec.ts            # sign-up + sign-in + TOTP enrolment flow
│   ├── experiences.spec.ts     # experience CRUD round-trip (requires db:seed)
│   ├── experiences-hours.spec.ts  # hours triple valid-save + constraint-violation→inline-error (TEST-019)
│   ├── experiences-pii-fields.spec.ts  # contact PII round-trip + consent-off hidden fields (TEST-020)
│   ├── experiences-validation.spec.ts  # client-side Zod validation: over-length org, bad phone, over-length narrative (TEST-021)
│   ├── experiences-detail.spec.ts  # flyout open/render-fields/close round-trip (TEST-022)
│   ├── experiences-frequency.spec.ts  # frequency enum + isCurrent/endDate toggle paths (TEST-023)
│   ├── admin-mentor-flow.spec.ts  # admin creates category + grant → mentor mode → revocation (TEST-007)
│   ├── pii-gate.spec.ts        # PII gate ABAC invariant: mentor sees '—' when permissionToContact=false, actual PII after consent (TEST-024)
│   ├── mentor-read.spec.ts     # mentor reads applicant experiences via grant; asserts pii_access_log roster-level row (TEST-025)
│   ├── admin-category-lifecycle.spec.ts  # admin create → edit name → deactivate; applicant tab bar no longer shows deactivated category (TEST-026)
│   ├── rbac.spec.ts            # applicant → /admin bounce to /experiences; API 403 on mentor-grants + category-create (TEST-027)
│   ├── error-cases.spec.ts     # rate-limit 429, non-existent resource 404, 401 session-expiry re-auth redirect (TEST-028)
│   ├── password-reset.spec.ts  # forgot-password → reset-URL → new-password → sign-in round-trip (CI-only). TEST-016.
│   ├── workflow-smoke.spec.ts  # pre-auth storageState smoke: applicant views experiences + detail, mentor views grants, admin views categories; all three roles log out (TEST-030).
│   ├── pm024-smoke.spec.ts     # role-based redirect smoke (applicant→/experiences, admin→/admin) + admin write-block 403 assertion (TEST-035).
│   ├── admin-user-management.spec.ts  # admin promotes applicant to admin, new admin reaches /admin (TEST-039)
│   ├── mentor-request-flow.spec.ts  # applicant requests mentor → admin approves → mentor sees applicant in ApplicantPicker (TEST-041)
│   ├── experience-verification.spec.ts  # mentor verifies applicant experience from flyout; applicant sees read-only verified badge (TEST-043)
│   ├── admin-spa-nav.spec.ts       # admin nav links change route without full-page reload; sentinel confirms client-side navigation (TEST-045)
│   ├── experience-delete-confirm.spec.ts  # dismiss confirm → row stays; accept confirm → row removed (TEST-045)
│   ├── uat/
│   │   ├── run-uat.ts          # Single-command UAT runner: starts dev servers, seeds UAT DB (seed:uat), runs uat:setup (writes storageState files for workflow-smoke), runs auth.spec.ts + workflow-smoke.spec.ts, tears down. Exit 0 = pass. TEST-031/TEST-032.
│   │   ├── setup-all.ts        # Manual TOTP-enrollment entrypoint (pnpm uat:setup); enrolls each UAT account and writes storageState to os.tmpdir(). UAT-020.
│   │   ├── README.md           # Preconditions, env-var table, exit-code contract for the UAT runner.
│   │   └── .uat-secrets.json   # Generated by seed:uat; gitignored. Contains TOTP secrets and stable UAT account credentials.
│   ├── helpers/
│   │   └── sessionSetup.ts     # Shared TOTP sign-up/enrolment/sign-in helpers extracted from fixtures (TEST-057): signUpAndEnrolTotp() — raw-fetch sign-up + TOTP enable (UI-092 password fix) + verify, returns TOTP secret; signInWithTotp() — UI sign-in + TOTP challenge completion; writeStorageState() — persists browser auth state.
│   └── fixtures/
│       ├── applicantSession.ts # sign-up + TOTP + sign-in fixture; writes storageState to tmp file. Uses sessionSetup.ts helpers (TEST-057).
│       ├── adminSession.ts     # sign-up + TOTP + admin-promote + sign-in fixture; writes storageState to tmp file. Uses sessionSetup.ts helpers (TEST-057). TEST-024.
│       ├── mentorSession.ts    # sign-up + TOTP + sign-in fixture (no grant); writes storageState to tmp file. Uses sessionSetup.ts helpers (TEST-057). TEST-024.
│       └── logCapture.ts       # extractResetUrl(email) — polls `docker logs asp-e2e` for ConsoleMailerAdapter reset-URL log lines; CI-only (throws outside CI). TEST-017.
├── docs/
├── Dockerfile                  # Multi-stage image: stage 1 builds UI+API; stage 2 runtime with pruned prod deps. INFRA-024.
├── docker-compose.yml          # Production app-layer service (no DB service — external DB required). INFRA-026.
├── docker/
│   └── entrypoint.sh          # POSIX dispatch: migrate | serve | seed | admin:promote. INFRA-025.
├── .dockerignore               # Excludes secrets, test artefacts, docs from build context. INFRA-027.
├── docs/
│   └── operations.md          # Operator runbook: first deploy, upgrades, backup/restore, troubleshooting. INFRA-028.
├── .env.example                # Canonical env inventory; no local infra
├── .github/workflows/ci.yml
├── package.json                # pnpm workspace root
└── pnpm-workspace.yaml
```

---

## UI modules

| Component | Route | Description |
|-----------|-------|-------------|
| `ProfilePage` | `/profile` | Editable form for applicant name, school, major, graduation year, phone, LinkedIn URL, portfolio URL, and bio. Reads from `GET /me/profile`; writes via `PATCH /me/profile`. GPA field intentionally absent (privacy-sensitive; not surfaced to mentors — UI-095). |

---

## Layer rules

| Layer | May import from | May not import from |
|-------|----------------|---------------------|
| routes/ | services/, lib/ | db/ directly |
| services/ | db/, lib/ | routes/ |
| db/ | lib/config.ts (via index.ts) | routes/, services/ |
| plugins/ | lib/ | routes/, services/, db/ |
| lib/ | node built-ins, approved SDKs | routes/, services/, db/ |

Only `lib/storage.ts` may import `@aws-sdk/*`. Only `lib/ai.ts` may import
`@anthropic-ai/sdk`. Only `lib/mailerAdapters/resend.ts` may import the `resend` SDK
(the `lib/mailer.ts` seam delegates to adapters; the SDK import is confined to the adapter file).
Enforced by ESLint `no-restricted-imports` on `routes/`, `services/`, `agents/`. `process.env` is read only in `lib/config.ts` (Phase 1),
`db/index.ts` (Phase 2) — the two server-runtime readers — plus all standalone CLI
scripts in `src/scripts/` (e.g. `drizzle.config.ts` and all `src/scripts/*.ts`)
and approved seed scripts in `src/db/` (`src/db/seed.uat.ts`)
which read `process.env` directly as they run outside the Fastify process.

The `lib/ → (routes, services, db)` constraint is enforced by `layer-model.test.ts`
case 5 (TEST-018, closes CER-006).

---

## Build commands

```bash
# Typecheck + test (all packages)
pnpm typecheck && pnpm test

# Lint (all packages)
pnpm lint

# Dev servers (both packages concurrently)
pnpm dev   # API on :6040, UI on :6041

# Per-package (useful in CI)
pnpm --filter @asp/api typecheck
pnpm --filter @asp/api test
pnpm --filter @asp/api lint
pnpm --filter @asp/ui typecheck
pnpm --filter @asp/ui test
pnpm --filter @asp/ui lint
```

The integration vitest project runs with `fileParallelism: false` (TEST-055,
`api/vitest.config.ts`). All integration files share one test database that is
cleaned once in `tests/globalSetup.ts`; file-level serialisation prevents
DB-state interleaving when the `unit` and `integration` projects run together
under the combined `pnpm test` invocation. The `unit` project stays fully
parallel. Do not remove this setting without first adding per-file DB isolation
to the integration tests, or the combined run becomes non-deterministic again.

The combined `pnpm test` runs green from a **cold shell** with neither
`NODE_ENV` nor `DATABASE_URL_TEST` exported (TEST-056, resolves CER-039). Two
coordinated, dependency-free mechanisms make this work:

- A single-key loader at the top of `api/vitest.config.ts`
  (`tests/loadDatabaseUrlTest.ts`) reads **only** `DATABASE_URL_TEST` from
  `api/.env.local` when present and not already exported. It runs in the vitest
  main process before `globalSetup` and before workers fork, so the value is
  inherited everywhere it is needed. The dev `DATABASE_URL` and
  `NODE_ENV=development` in that file are deliberately **not** loaded — copying
  them could point an integration run at the dev database.
- The integration `globalSetup` unconditionally forces `process.env.NODE_ENV =
  'test'` (not `||=`), so a stray `NODE_ENV=development` in the shell (e.g. from
  a sourced `.env.local`) no longer trips `assertTestDb()`'s refusal.

The `assertTestDb` DB-name guard in `api/src/db/testdb.ts` still independently
protects which database is targeted: forcing `NODE_ENV=test` is safe precisely
because the suite still refuses to run unless the connected database name
contains `'test'`. CI is unaffected — it exports `DATABASE_URL_TEST` via its
Postgres service container, so the loader no-ops there.

---

## Protected files

These files are working and must not be modified without a stated reason:

| File | Protection | Modified only when... |
|------|-----------|----------------------|
| api/src/db/schema/ | PROTECTED (Phase 2+) | Story explicitly names a schema change; migration generated; ADR note added here |
| api/src/lib/config.ts | High-care | Story explicitly adds/removes an env var |
| .github/workflows/ci.yml | High-care | Story modifies CI topology |

---

## Dev port assignments

| Port | Service |
|------|---------|
| 6040 | @asp/api (Fastify) |
| 6041 | @asp/ui (Vite) |
| 6042–6049 | Reserved for asp dev services (unassigned) |

All asp dev servers must bind in the 6040–6049 range (constraint from
`docs/brief.md` and `docs/ideology.md`). No asp dev process may use a port
outside this range.

---

## ADR log

### ADR-001 — CORS plugin is fp-wrapped (Phase 1, INFRA-010)

**Decision:** `api/src/plugins/cors.ts` wraps `aspCorsPlugin` with
`fastify-plugin` (fp), making it transparent to Fastify's encapsulation.

**Rationale:** `@fastify/cors` is itself fp-wrapped internally. Its CORS
handling is implemented as an `onRequest` hook. When our wrapper is NOT
fp-wrapped, `@fastify/cors`'s hook registers in the wrapper's encapsulated
scope; routes registered as siblings of the wrapper in `buildApp()` never
receive the hook. Wrapping our plugin with `fp` makes it transparent so the
hook propagates to the root Fastify instance and reaches all subsequently-
registered routes (including `/api/health` and the Phase 2 `/api/auth/*`
routes). The one-time registration in `buildApp()` is preserved; `fp` only
controls scope propagation, not registration count.

**Alternative rejected:** Non-fp-wrapped per original spec instruction.
Rejected because the CORS gate would not reach sibling routes, failing the
acceptance criterion "no Access-Control-Allow-Origin for mismatched origins."

### ADR-002 — CORS origin is a callback, not a string (Phase 1, INFRA-010)

**Decision:** `@fastify/cors` is configured with an `origin` callback
function rather than `origin: config.ALLOWED_ORIGINS` (plain string/array). The
callback checks membership of the request `Origin` in the `config.ALLOWED_ORIGINS`
allow-list (INFRA-052 made this a comma-separated list; the pre-INFRA-052 form
was a single `config.ALLOWED_ORIGIN` string).

**Rationale:** When `@fastify/cors` receives a plain string as `origin`, its
internal `getAccessControlAllowOriginHeader` function returns that string
verbatim regardless of the request's `Origin` header. A request from a
mismatched origin would still receive the `Access-Control-Allow-Origin` header
— violating the "no allow-origin for mismatched origin" acceptance criterion.
The callback form returns `false` for mismatched origins, which causes
`@fastify/cors` to suppress the header entirely — which is what the browser's
same-origin enforcement requires.

**Alternative rejected:** Plain string form per original spec instruction.
Rejected because it does not satisfy the mismatched-origin blocking criterion.

### ADR-003 — BA auth schema uses text PKs and no cross-boundary FKs (Phase 2, AUTH-001)

**Decision:** The BA-owned tables (`users`, `sessions`, `accounts`, `verification`) use `text`
primary keys (not serial integers) and the `sessions`/`accounts` tables reference `users.id`
as a plain `text` column without a Drizzle `references()` FK declaration at the app layer.

**Rationale:** Better Auth generates its own IDs (nanoid / UUID). Imposing integer PKs would
require BA configuration overrides that diverge from BA's defaults and make upgrades harder.
FK declarations at the Drizzle level in app schema files would couple app migrations to BA's
internal schema changes. Since BA manages its own tables, app code never inserts into `users`
directly — all identity operations go through `/api/auth/*`. The absence of Drizzle FKs is
intentional and enforced by the schema protection rule.

**Alternative rejected:** integer PKs with Drizzle `references()`. Rejected because BA's
ID format is text-based and cross-boundary Drizzle FKs tightly couple the app migration
graph to BA internals.

**AUTH-003 addendum — twoFactor plugin schema:** The `twoFactor` plugin adds a `twoFactorEnabled`
boolean column to `users` and a new `two_factor` table (`id`, `secret`, `backup_codes`,
`user_id`, `verified`). The `two_factor.user_id` column is intentionally NOT declared as
a Drizzle `references()` FK, consistent with ADR-003. The `twoFactor` table is exported
from `api/src/db/schema/auth.ts` under the key `twoFactor` to match BA's internal model
name. Migration: `drizzle/0001_quick_black_queen.sql`.

### ADR-004 — protectedScope plugin uses DI opts to preserve layer model (Phase 2, AUTH-004)

**Decision:** `api/src/plugins/protectedScope.ts` accepts `registerSessionLoader` and `mfaGate`
as constructor opts (`ProtectedScopeOpts`) rather than importing them directly. The concrete
implementations are injected by `app.ts` (the composition root).

**Rationale:** The layer model forbids `plugins/` from importing `services/`. Without DI,
`protectedScope.ts` would need to import from `services/auth/sessionLoader` and
`services/auth/mfaGate`, violating the one-directional constraint. By accepting the dependencies
as typed function parameters, `protectedScope.ts` remains in the `plugins/` layer and imports
only from `fastify` (an approved SDK). `app.ts`, which is allowed to import from both layers,
acts as the wiring point.

**Alternative rejected:** Direct `services/` imports from `protectedScope.ts`. Rejected because
it breaks the layer model (HIGH finding in AUTH-004 attempt 1).

---

### ADR-005 — Better Auth owns the identity stack (Phase 2, DB-002)

**Status:** Accepted (2026-05-23, Phase 2)

**Context:**
asp needs identity (signup, signin, sessions, MFA). Two paths:
own the schema ourselves, or delegate to a library.

**Decision:**
Better Auth owns `users`, `sessions`, `accounts`, `verification`.
- Sessions live in PostgreSQL via BA's Drizzle adapter — no Redis.
- Cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`.
- TOTP (BA twoFactor plugin) is mandatory; grace window `MFA_GRACE_HOURS`
  (default 24).
- No Drizzle FK from any app table references `users`. Cross-boundary
  joins happen in application code only.

**Consequences:**
- BA version upgrades may require schema migrations we don't control.
- App code never directly inserts into `users` — sign-up always goes
  through `/api/auth/*`.
- Role grants and system roles (Phase 4) reference `users.id` as
  bare `text`, not as Drizzle FKs.

**Alternatives considered:**
- **Own the users table ourselves:** rejected. Identity is high-risk
  surface area; reimplementing it duplicates BA's correct work and
  introduces drift between asp's model and BA's evolving defaults.
- **Auth.js / NextAuth:** rejected. asp is Fastify-first; BA's
  Fastify-native integration is cleaner; BA's Drizzle adapter avoids
  a parallel ORM.
- **Redis-backed sessions:** rejected for asp itself. One fewer infra
  dependency. Downstream forks needing pub/sub may swap.

**Ideology entries codified:** `docs/ideology.md` — single-library
identity, no unnecessary infrastructure, mandatory MFA in production.

### ADR-006 — apiFetch is the shared fetch wrapper inside queryFn/mutationFn (Phase 3, superseded by UI-093)

**Original decision (Phase 3):** `fetch()` calls lived directly inside TanStack Query
`queryFn` and `mutationFn` callbacks with no shared wrapper, to avoid a hand-rolled
cache-layer anti-pattern. The error-shape seam (`{ status: number }` on non-2xx so the
QueryClient's `onError` can detect 401s) was maintained by convention and documented
in a comment in `queryClient.ts`.

**Superseded (UI-093):** `ui/src/lib/apiFetch.ts` now exists and is the canonical
fetch wrapper. Every hook `queryFn`/`mutationFn` calls `apiFetch<T>(url, opts?)` instead
of raw `fetch`. The wrapper always sends `credentials: 'include'` and, on a non-2xx
response, throws an `Error` instance carrying `{ status: number, body: unknown }` — the
exact shape `queryClient.ts` inspects for 401 re-auth. The error contract that was
previously convention (documented only in a `queryClient.ts` comment) is now enforced
structurally at a single throw site. This is a thin wrapper, not the rejected
cache-layer pattern: it holds no state and does not intercept caching — TanStack Query
still owns all server state. `credentials: 'include'` and raw `fetch()` to API URLs no
longer appear in any hook (grep-verified); they live only inside `apiFetch.ts`.
(Note: component-local and page-local fetches outside `ui/src/hooks/` retain inline `fetch` and were out of scope for UI-093: `CategoryPage.tsx`, `ExperienceForm.tsx`, `GrantsAdminPage.tsx`, `MilestoneAwardsAdminPage.tsx`, `RequestMentorModal.tsx`, `UsersAdminPage.tsx`, `SignUp.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `TotpEnrol.tsx`, `TotpChallenge.tsx`. Migrating these is deferred to a future phase.)

### ADR-007 — system_roles uses composite PK with no Drizzle FK to users (Phase 4, DB-003)

**Status:** Accepted (2026-05-24, Phase 4)

**Decision:** The `system_roles` table uses a composite primary key `(user_id, role)` and does
not declare a Drizzle `references()` FK to `users.id`.

**Rationale:** Consistent with ADR-003 — BA controls the user lifecycle; cross-boundary Drizzle
FKs create migration coupling between app schema files and BA's internal schema. The `user_id`
column is a bare `text` column that references `users.id` conceptually only. Role values are
constrained to `'admin'` and `'applicant'` by application-layer convention (text column, no DB
enum — avoids enum migration complexity for a small fixed set).

**Bootstrap path:** The first admin user is promoted via a direct SQL insert:
```sql
INSERT INTO system_roles (user_id, role) VALUES ('<id>', 'admin');
```
No automated bootstrap is implemented in this phase. All newly registered users receive the
`'applicant'` role automatically via the BA `databaseHooks.user.create.after` hook.
This hook behavior is implemented but only has table-existence integration test coverage
at Phase 4 end; full signup-flow integration coverage was deferred to Phase 6 (CER-004).
Resolved in Phase 10 (TEST-010): `api/tests/applicant-role-hook.integration.test.ts`
signs up a fresh user via `POST /api/auth/sign-up/email`, queries `system_roles` via
Drizzle, and asserts a `{ role: 'applicant' }` row exists for the returned user id.

**Alternative rejected:** Drizzle `references()` FK to `users.id`. Rejected for the same
reasons as ADR-003 — BA owns identity; cross-boundary FKs couple app migrations to BA internals.

---

### ADR-008 — mentor_grants.permissions is a text[] column, not a join table (Phase 4, DB-004)

**Status:** Accepted (2026-05-24, Phase 4)

**Decision:** The `mentor_grants.permissions` column is a `text[]` Postgres array column, not a
normalised join table.

**Rationale:** Phase 4 scope is scaffolding only; no UI or fine-grained permission enumeration
exists yet. A simple array avoids premature normalisation while keeping the schema self-contained.
If permissions grow complex in Phase 8 (fine-grained grant management UI), a join table can be
introduced with a migration at that time.

**Bootstrap path:** Grants are inserted by the admin via API (Phase 8 UI) or direct DB insert.
No automatic grant creation happens at signup — mentor grants are an explicit admin action.

**Alternative rejected:** A separate `mentor_grant_permissions` join table. Rejected because it
adds normalisation overhead with no benefit at current scope. The text array is sufficient for
Phase 4 and Phase 8 will decide if promotion to a join table is warranted.

---

### ADR-009 — Scoped pass-through content-type parser for Better Auth body bridging (Phase 4.5, AUTH-006)

**Status:** Accepted (2026-05-27, Phase 4.5)

**Context (defect):** `api/src/routes/auth.ts` delegates `/api/auth/*` to Better Auth via
`toNodeHandler(auth)(request.raw, reply.raw)` after `reply.hijack()`. Fastify's **default
`application/json` content-type parser drains `request.raw`** before the handler runs, so
Better Auth receives an empty stream and sees an `undefined` body. Every auth HTTP operation
(sign-up, sign-in, TOTP enable/verify) fails with a `VALIDATION_ERROR` 400. This defect has
been present since AUTH-001 (Phase 2); the auth flow has never worked end-to-end over HTTP.

**Decision:** Inside `authRoutes(fastify)` — before the `fastify.all` handler — register a
pass-through content-type parser that overrides Fastify's default JSON parser for this scope:

```ts
fastify.addContentTypeParser('application/json', (_req, _payload, done) => done(null, null));
```

The parser intentionally does NOT read `_payload`, so `request.raw` remains an unread stream
that `toNodeHandler` can consume.

**Why scoped:** `authRoutes` is registered via `app.register(authRoutes)` — an encapsulated
Fastify context. A content-type parser added inside an encapsulated plugin applies only to
routes registered within that plugin. Routes outside the auth plugin (including all Phase 6
routes that use `fastify-type-provider-zod` and require parsed JSON bodies) are unaffected.

**Alternative rejected:** Registering the pass-through parser on the root `buildApp()` instance.
Rejected because it would disable JSON parsing globally, breaking Phase 6 Zod-validated routes
that expect `request.body` to be a parsed object.

---

### ADR-010 — drizzleAdapter requires explicit schema map when drizzle() is initialized without a schema arg (Phase 4.5, AUTH-006 / CER-010)

**Status:** Accepted (2026-05-27, Phase 4.5)

**Context (defect):** `api/src/db/index.ts` calls `drizzle(pool)` with no `schema` argument, so
`db._.fullSchema` is empty. Better Auth's `drizzleAdapter` uses `db._.fullSchema` for table
auto-discovery — it looks for tables by BA's singular default names (`user`, `session`,
`account`). Our tables are plural (`users`, `sessions`, `accounts`), so auto-discovery fails
silently and every auth DB operation fails. Masked by the body-bridging defect (CER-007) and
the never-passing integration suite. Recorded as CER-010.

**Decision:** Pass an explicit `schema` map (BA model name → Drizzle table object) to
`drizzleAdapter` in `api/src/services/auth/index.ts`:

```ts
drizzleAdapter(db, {
  provider: 'pg',
  schema: { user: users, session: sessions, account: accounts, verification, twoFactor: twoFactorTable },
})
```

**Why not fix db/index.ts:** `db/index.ts` is a general-purpose pool that Drizzle uses for
all app queries. Passing a schema to `drizzle(pool, { schema })` there would require importing
all schema modules at the `db/` layer — coupling that makes `db/index.ts` aware of every
domain table. The explicit schema map in the auth service keeps the mapping local to its consumer.

**Alternative rejected:** Fixing `db/index.ts` to pass a schema. Rejected because it makes the
database layer aware of all schema modules, violating the layer model and increasing coupling at
the pool level.

---

### ADR-011 — frequency_of_experience is a Postgres native enum, not a text CHECK (Phase 5, DB-006)

**Status:** Accepted (2026-05-28, Phase 5)

**Context:** The `experiences` table (added in DB-007) needs a `frequency` column that is constrained to exactly three values: `temporary`, `recurring`, and `ongoing`. These are operator-confirmed VMCAS vocabulary terms that describe how often a pre-professional experience occurs.

**Decision:** Implement `frequency_of_experience` as a Postgres native enum (via Drizzle's `pgEnum`) rather than a `text` column with a `CHECK` constraint.

**Rationale:**
- **Type safety:** A native enum is its own Postgres type; the database rejects out-of-range values at the type level before any CHECK evaluation.
- **Self-documenting schema:** `\dT frequency_of_experience` in psql lists the exact allowed values, making the schema readable without consulting application code.
- **Drizzle codegen:** `pgEnum` produces TypeScript union types automatically (`'temporary' | 'recurring' | 'ongoing'`), catching misuse at compile time in DB-007 and all consumers.
- **Trade-off — migration cost:** Adding a new enum value requires `ALTER TYPE ... ADD VALUE`, which is an exclusive-lock DDL statement in Postgres. For a small, stable vocabulary (VMCAS terms change rarely), this cost is acceptable. If the value set were expected to grow frequently, a lookup table would be preferable.

**Values (`temporary | recurring | ongoing`):** Confirmed by the operator as the three VMCAS frequency categories for pre-professional experiences. No other values are valid in the current domain.

**Consumption:** DB-007 adds the `experiences.frequency` column using this enum. No consuming column exists in DB-006 — the enum type is declared here to ensure the migration ordering is correct (type must precede column).

**Alternative rejected:** `text` column with `CHECK (frequency IN ('temporary','recurring','ongoing'))`. Rejected because it forgoes compile-time type safety, is less visible in introspection, and provides no advantage over a native enum for a fixed, small vocabulary.

---

### ADR-012 — hours-triple CHECK enforces arithmetic consistency (Phase 5, DB-008)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** The `experiences` table enforces `total_hours = hours_per_week * number_of_weeks` as a DB CHECK constraint, not just at the application layer.

**Rationale:** Defence-in-depth — Phase 6 mirrors these as Zod bounds, but the DB CHECK is the last line. `hours_per_week <= 168` prevents data entry errors (168 = hours in a week). `total_hours <= 100000` prevents pathological values (~114 years at 168 h/w).

**Alternative rejected:** Validation only at the Zod layer. Rejected because it would allow API bypasses (direct DB inserts) to store inconsistent data.

---

### ADR-013 — Location columns are all nullable with IS NULL OR CHECKs (Phase 5, DB-009)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** All five location columns (`state_province`, `state_province_code`, `country`, `country_iso2`, `country_iso3`) are nullable; CHECK constraints use the `IS NULL OR char_length(...) <= N` pattern.

**Rationale:** Location is optional per the experience data model — not every experience has a meaningful or known location. ISO codes have fixed lengths (`country_iso2` = exactly 2, `country_iso3` = exactly 3) enforced as exact-length CHECKs. Free-text fields (`state_province`, `country`) use max-length CHECKs (`<= 128`) to prevent runaway input without constraining valid values. The `IS NULL OR` guard prevents CHECK violations on legitimate NULL values — without it, `char_length(NULL)` returns NULL (not an integer), causing the constraint to pass unexpectedly on some DB versions; the explicit `IS NULL` guard makes intent clear and portable.

**Alternative rejected:** NOT NULL with empty-string defaults. Rejected because empty strings are semantically distinct from "not provided" and would require application-layer guards everywhere to distinguish "empty" from "not given." Nullable columns with the `IS NULL OR` guard pattern are the canonical way to express optional data with format constraints.

---

### ADR-014 — permissionToContact defaults to false (opt-in consent model) (Phase 5, DB-010)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** All six attestation booleans default to `false`. `permissionToContact` is load-bearing for PII access control: Phase 6 (API-007/API-008) gates exposure of `contact_*` fields to non-owner (mentor) readers on this flag.

**Rationale:** Consent must be explicit. A default of `true` would expose PII to mentors without the applicant ever making an active choice. The `false` default requires the applicant to actively grant contact permission, matching the opt-in model required for defensible data handling.

**Alternative rejected:** Default `true` (opt-out). Rejected because it exposes PII to third parties without explicit consent, violating the principle of least privilege.

---

### ADR-015 — Contact fields are nullable PII gated by permissionToContact; phone uses E.164 CHECK (Phase 5, DB-011)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** All five contact columns (`contact_title`, `contact_first_name`, `contact_last_name`, `contact_email`, `contact_phone`) are nullable text. Phone format is enforced as an E.164 regex CHECK at the DB layer. Contact field length CHECKs are deferred to DB-012.

**Rationale:** Contact is optional — not all experiences have reference contacts. E.164 (`^\+[1-9]\d{1,14}$`) is the international standard for phone numbers; enforcing it at the DB layer prevents invalid formats reaching the API. The `IS NULL OR` guard is required for nullable columns (same pattern as location CHECKs in ADR-013). Length CHECKs are consolidated in DB-012 for the full text-field sweep.

**PII access control:** In Phase 6, the `contact_*` fields are gated behind `permissionToContact = true` for non-owner readers (ADR-014). The schema stores the data; the access gate is enforced at the API layer.

**Alternative rejected:** NOT NULL with empty strings for phone/email. Rejected — same reason as location columns (ADR-013): empty string is semantically distinct from "not provided."

---

### ADR-016 — Text-length CHECK sweep completes the experience schema (Phase 5, DB-012)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** A dedicated sweep story (DB-012) adds length CHECKs to all remaining unconstrained text columns in the `experiences` table: `organization` and `position` (<=256), `duties_narrative` (<=8192), contact name fields (`contact_title`, `contact_first_name`, `contact_last_name`) (<=128), and `contact_email` (<=320). After this story, no `text` column in the experience domain (`experience_categories`, `experiences`) is unbounded.

**Rationale:** The ideology mandates "every text column has a max-length CHECK" for defence-in-depth. Consolidating all remaining length CHECKs in one story produces one migration, simplifies the completeness audit, and makes it easy to verify the invariant. The completeness audit is encoded as an integration test (db-012.test.ts) that queries `information_schema.columns` and `pg_constraint` to assert every `text` column has a CHECK.

**Bounds rationale:** 256 chars for `organization`/`position` matches common form field limits. 8192 chars for `duties_narrative` (~2 pages of plain text) allows sufficient detail without enabling unbounded storage. Email 320 = RFC 5321 max (local 64 + `@` + domain 255). Contact name fields 128 chars covers all practical names including honorifics.

**Alternative rejected:** Per-column CHECKs in each column-addition story. Rejected because it would scatter the completeness responsibility across multiple stories and make the invariant harder to audit. A dedicated sweep story is the single point of authority for the completeness guarantee.

---

### ADR-017 — Flat `experiences` table over 1:1 detail tables (Phase 5, DB-007)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** All experience columns (core fields, hours triple, location, attestation, and contact PII) live in a single wide `experiences` table rather than being split across 1:1 detail tables (e.g., `experience_locations`, `experience_contacts`).

**Rationale:** The visual model presents an experience as a single, unified record — every field appears on one form. A flat table keeps the hours-rollup query (summing `total_hours` per owner or category) single-table with no joins. Splitting into detail tables would require joins on every read for no benefit: the sub-tables would always be 1:1, their PKs would be the same as the parent, and the schema complexity would exceed any normalisation gain. The wide row never reaches the column limit for any reasonable experience record.

**Alternative rejected:** 1:1 detail tables (`experience_locations`, `experience_contacts`). Rejected because they add join complexity on every read path with no normalisation benefit for 1:1 relationships. A join table is warranted when the relationship is 1:N or M:N; this is always 1:1.

---

### ADR-018 — `experience_categories` is admin-managed RBAC reference data (Phase 5, DB-005)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** `experience_categories` is a separate table from `experiences`, managed exclusively by admin users via RBAC. Applicants may read categories (to populate the `category_id` column on their experiences) but may not create, update, or delete them.

**Rationale:** Categories are system reference data — a fixed vocabulary the operator controls, not applicant-owned content. This makes them RBAC-governed (role-based, system-level write gate) rather than ABAC-governed. Mixing them into the `experiences` table would conflate system reference data with applicant content and prevent independent lifecycle management (e.g., deactivating a category without touching experience rows). Keeping them in a separate table with their own `is_active` and `sort_order` columns gives the operator full control over the category vocabulary.

**Management surface:** Schema-only in Phase 5. Seed script DB-015, CRUD API API-005/API-006 (Phase 6), admin UI UI-017 (Phase 8).

**Alternative rejected:** Inline category as a `text` column on `experiences`. Rejected because free-text categories cannot be enumerated, sorted, or deactivated without a full table scan and application-layer aggregation. A reference table is the correct model for operator-managed vocabulary.

---

### ADR-019 — `category_id` FK is app-internal and permitted; ADR-003 scope is `users` only (Phase 5, DB-007)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** `experiences.category_id` declares a Drizzle `references()` FK to `experience_categories.id`. This is explicitly permitted and does not conflict with ADR-003.

**Rationale:** ADR-003 forbids FKs from app tables to Better Auth's `users` table specifically. The concern is coupling the app migration graph to BA's internal schema, which the app does not own. `experience_categories` is an app-owned table; the app controls both sides of the FK. Using Drizzle `references()` here gives the correct DB-level enforcement (referential integrity), generates the right migration, and makes the relationship explicit in the schema. The pattern is: no Drizzle FK across the BA boundary; normal Drizzle FKs within the app-owned boundary.

**Alternative rejected:** Bare `uuid` column with no Drizzle `references()`. Rejected because omitting the FK would silently allow orphan `category_id` values. Within the app-owned boundary, referential integrity is a benefit, not a coupling risk.

---

### ADR-020 — App-owned tables use DB-generated uuid PKs via `defaultRandom()` (Phase 5, DB-005/DB-007/DB-016)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** `experience_categories`, `experiences`, and `pii_access_log` use `uuid` primary keys generated by the database via Drizzle's `defaultRandom()` (maps to `gen_random_uuid()`). The app never supplies these PKs on insert.

**Rationale:** DB-generated uuids suit tables the app inserts into directly — no coordination is needed between the application layer and the database to agree on an ID before the insert. This contrasts with: (a) Better Auth's `users` table, which uses text PKs that BA generates itself (nanoid/UUID — BA controls ID generation); and (b) `mentor_grants`, whose `id` is an app-supplied text column (legacy Phase 4 decision, carries forward). For new app-owned tables introduced from Phase 5 onward, DB-generated uuid PKs are the standard.

**Alternative rejected:** Application-supplied UUIDs (e.g., generated in TypeScript before insert). Rejected because it adds round-trip coordination overhead with no benefit for tables the app alone inserts into. DB-generated uuids are simpler and remove a class of ID-collision bugs.

---

### ADR-021 — `pii_access_log` is append-only; no management UI required (Phase 5, DB-016)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** The `pii_access_log` table records who read or changed contact PII on an experience. It is strictly append-only: application code never issues `UPDATE` or `DELETE` against it. Because the table is an append-only audit log, it qualifies for the schema-gate exception documented in `docs/phases/` — no dedicated management UI is required for this table.

**Rationale:** An audit log's value comes from its immutability. Allowing updates or deletes would undermine the non-repudiation guarantee that makes the log useful for compliance and access review. The append-only constraint means: no edit form, no delete button, and no admin CRUD API are needed or appropriate. Future observability tooling (a log viewer or an export endpoint) may surface these records, but that is a read-only concern, not a management concern. This exception is explicitly noted here so the absence of a management UI story for `pii_access_log` is deliberate and documented, not an oversight.

**ADR-021 amendment (TEST-025):** A read-only listing endpoint `GET /api/admin/pii-log` now exists (`api/src/routes/pii-access-log.ts`). This endpoint is admin-only and supports optional `mentorUserId` / `applicantUserId` / `limit` query params. It is strictly read-only — it performs no writes and does not constitute a management UI. Providing a read path for the audit log is consistent with the append-only stance: the log can be observed by admins without any mutation path being exposed.

**Alternative rejected:** Mutable audit table with update/delete support. Rejected because mutable audit records are not audit records — they can be silently altered, which defeats the purpose of the log.

---

### ADR-022 — Value CHECK constraints on `system_roles.role` and `mentor_grants.status` (Phase 5, DB-017)

**Status:** Accepted (2026-05-28, Phase 5)

**Decision:** `system_roles.role` is constrained to `('admin', 'applicant')` and `mentor_grants.status` is constrained to `('active', 'revoked')` via named DB CHECK constraints (`system_roles_role_values` and `mentor_grants_status_values` respectively). These are added via migration `0013_rare_punisher.sql`.

**Rationale:** The asp ideology requires every text column to have a max-length or value CHECK. Both columns were initially introduced in Phase 4 (DB-003/DB-004) with only application-layer convention enforcing valid values. Adding DB-level CHECKs closes CER-005 by ensuring that no direct DB insert (bypassing the API) can store an invalid role or status. The value sets are small and fixed — `role` has two valid values (`admin`, `applicant`) and `status` has two valid values (`active`, `revoked`). Using a text CHECK rather than a Postgres enum avoids the `ALTER TYPE ... ADD VALUE` migration complexity if values are added later, while still providing DB-level enforcement.

**Why not native enum:** `frequency_of_experience` (ADR-011) uses a native enum because its values are VMCAS vocabulary terms that are operator-confirmed stable. `system_roles.role` and `mentor_grants.status` are app-internal control values that may expand (e.g., a future `mentor` role or a `suspended` grant status). Text CHECKs are easier to evolve — adding a value is a simple `ALTER TABLE ... ADD CONSTRAINT ... CHECK (... IN (...))` after dropping the old constraint, whereas enum value additions require exclusive-lock DDL.

**Alternative rejected:** Leaving value enforcement to the application layer only. Rejected because a direct DB insert (e.g., during an operator bootstrap or a future migration) could store an invalid role or status without any error, silently corrupting the RBAC/ABAC model.

---

### ADR-024 — Single-origin production deployment via @fastify/static when STATIC_UI_ROOT is set (Phase 9, INFRA-013)

**Status:** Accepted (2026-05-30, Phase 9)

**Decision:** When `STATIC_UI_ROOT` environment variable is set, the API registers a `@fastify/static` plugin (`api/src/plugins/staticUi.ts`) to serve the built UI bundle from a filesystem path. The plugin is enabled only in production; it is a strict no-op in development and test environments where `STATIC_UI_ROOT` is absent.

**Rationale:** MVP production deployments require a simple, single-origin topology. The UI calls `/api/*` as relative paths (no explicit host/protocol), so serving both the UI bundle and API routes from the same origin (`http://host`) requires no reverse-proxy configuration. This reduces infrastructure complexity for entry-level deployments while preserving the dev/test workflow (two separate Vite and Fastify dev servers). The plugin reads `STATIC_UI_ROOT` via `config.ts`, maintaining the single-reader pattern for `process.env` containment.

**Constraints preserved:**
- `ALLOWED_ORIGINS` remains required in all environments (enforced at startup). Incoming CORS requests from cross-origin API clients are gated via the CORS policy (ADR-001/ADR-002).
- Development workflow unchanged: `pnpm dev` starts two independent servers (`@asp/api` on :6040, `@asp/ui` on :6041). No build step required for local iteration.
- Test suite unaffected: `STATIC_UI_ROOT` is absent in test environments; `staticUi.ts` has no-op pass-through logic for an unset variable.

**No-op in dev/test:** The plugin checks `if (!config.STATIC_UI_ROOT) return;` at registration time. When the variable is absent or empty, the plugin performs no registration or route binding. Note: `@fastify/static` must be listed in `api/package.json` `dependencies` (not `devDependencies`) because the top-level ESM `import FastifyStatic from '@fastify/static'` is evaluated at module load time regardless of whether `STATIC_UI_ROOT` is set — a devDependency would be pruned from a production `node_modules` and crash the process on startup with `ERR_MODULE_NOT_FOUND`.

**Alternative rejected:** Operator-managed reverse-proxy (nginx, HAProxy). Rejected because it adds infrastructure overhead and operational complexity outside the app's control. The `@fastify/static` plugin keeps deployment self-contained and is removed by setting `STATIC_UI_ROOT=""` if the operator later chooses to decouple layers.

---

### ADR-025 — Migration runner is explicit subcommand, never auto-run on startup (Phase 10, INFRA-017)

**Status:** Accepted (2026-05-31, Phase 10)

**Decision:** The migration runner is an explicit `pnpm --filter @asp/api migrate:run` subcommand. Migrations are never auto-executed inside `app.ts` or `index.ts` on server startup.

**Rationale:** The remote database may have in-flight migrations or replication lag. The operator triggers each deployment step deliberately to maintain visibility and control. Auto-migration on startup introduces a race condition between concurrent deploy instances: if multiple replicas boot simultaneously after a code push, they all attempt to run the same migration concurrently, leading to lock contention and potential partial application failures. Additionally, auto-migration prevents the operator from separating the `migrate` step from the `serve` step in their deployment sequence, eliminating flexibility for multi-stage deployment pipelines (e.g., migrate, health-check, canary-serve, full-serve).

**Consequence:** Operators must run `pnpm --filter @asp/api migrate:run` before `start` when deploying a new version that includes schema changes. Phase 12 (Dockerfile) wires this as a container entrypoint step, ensuring migrations run once at deploy time rather than being distributed across multiple replica startups.

**Alternative rejected:** Auto-migration on `serve` startup. Rejected because it creates a race condition between concurrent deploy instances and prevents operators from separating migration from serve in their deployment sequence, reducing operational control and introducing unpredictable timing windows.

---

### ADR-026 — 255-char CHECK is the standard for BA-identity soft references (Phase 10, DB-018)

**Status:** Accepted (2026-05-30, Phase 10)

**Context (CER-011):** App-owned tables hold soft references to `users.id` as bare `text` columns per ADR-003 (no cross-boundary Drizzle FK — BA owns identity). `pii_access_log.actor_user_id` and `pii_access_log.subject_user_id` carry a 255-char CHECK (DB-016) for defence-in-depth, but the equivalent BA-identity columns on `experiences`, `system_roles`, and `mentor_grants` were introduced without length CHECKs. This asymmetry was tracked as CER-011 and is closed by DB-018.

**Decision:** Every app-owned `text` column that holds a soft reference to `users.id` carries a named DB CHECK constraint of the form `CHECK (char_length(<col>) <= 255)`, with the constraint named `<table>_<col>_len`. Columns covered by DB-018:

- `experiences.owner_user_id` → `experiences_owner_user_id_len`
- `system_roles.user_id` → `system_roles_user_id_len`
- `mentor_grants.mentor_user_id` → `mentor_grants_mentor_user_id_len`
- `mentor_grants.applicant_user_id` → `mentor_grants_applicant_user_id_len`
- `mentor_grants.granted_by_user_id` → `mentor_grants_granted_by_user_id_len`

All five are NOT NULL columns; no `IS NULL OR` guard is needed (contrast with nullable PII columns per ADR-013/ADR-015). The 255-char bound matches the existing `pii_access_log.actor_user_id` / `subject_user_id` CHECKs (DB-016) and comfortably exceeds any plausible BA-generated ID format (nanoid ≤ 21 chars, UUID = 36 chars).

**Rationale:** The asp ideology mandates "every text column has a max-length CHECK." Without these CHECKs, a malformed or adversarial soft-reference value (e.g. a smuggled 1-MB string) could be written by a future bug or by a direct DB insert that bypasses application validation, with no defence at the DB layer. The 255-char bound is the project standard for BA-identity soft references; future app-owned tables that hold a `users.id` soft reference must follow the same pattern.

**Migration:** `0014_skinny_king_cobra.sql` adds the five CHECK constraints. Because all referenced columns currently hold BA-generated values well under 255 chars, the migration applies without any data backfill or validation failures against existing rows.

**Alternative rejected:** Per-column exemption documented in architecture.md rather than a CHECK. Rejected because documentation does not prevent corrupt writes; the DB CHECK is the actual enforcement and the only durable guarantee.

---

### ADR-027 — MailerClient is the single email seam; no direct SDK imports outside lib/mailer* (Phase 11, INFRA-020/023, AUTH-007)

**Status:** Accepted (2026-06-01, Phase 11)

**Decision:** `MailerClient` is the single email seam. All email sends go through the interface; BA email callbacks delegate to it. No direct Resend/SMTP SDK imports outside `lib/mailer.ts` and `lib/mailerAdapters/`.

**Rationale:** Single-seam-per-external-concern pattern (same as `lib/storage.ts`, `lib/ai.ts`). Enables test injection (`ConsoleMailerAdapter`), provider swapping, and a consistent audit surface for outbound email. Confining the SDK import to `lib/mailerAdapters/resend.ts` means the rest of the codebase has no dependency on the Resend package and can swap providers without touching call sites.

**Consequences:**

1. `ConsoleMailerAdapter` is the approved dev/test substitute. `MAILER_PROVIDER=console` is rejected in production (INFRA-022 `superRefine`), unless `CI=true` — that bypass allows the production image to run the E2E suite without a live mailer (INFRA-033). Adding a new email event type requires a new method on `MailerClient` and an implementation in each adapter.
2. `setMailer()` late-binding is used to wire the Fastify-decorated mailer into the module-level BA auth callback (AUTH-007). This is the only module-level mutable state in the auth module; it is set once at startup by `app.ts` and by tests before `buildApp()`.

**Alternative rejected:** Importing the Resend SDK directly inside `services/auth/index.ts` where the BA `sendResetPassword` callback lives. Rejected because it would couple the auth service to a specific email provider, prevent test injection without process-level env var juggling, and violate the single-seam discipline established by `lib/storage.ts` and `lib/ai.ts`.

---

### ADR-028 — Single-container deployment: API serves UI; docker-compose app layer only; PORT 6040–6049 (Phase 12, INFRA-024/029)

**Status:** Accepted (2026-06-01, Phase 12)

**Decision:** Production deployment is a single container. The API serves the built UI via `@fastify/static` (ADR-024). `docker-compose.yml` contains the app service only — no Postgres service. HTTPS is terminated by the host platform. The `PORT` environment variable must be in the range 6040–6049. Lifecycle operations (migrations, seeding, admin promotion) dispatch via ENTRYPOINT to `migrate`, `serve`, `seed`, or `admin:promote` subcommands.

**Rationale:** A Postgres service in compose would introduce a local-infra dependency that downstream forks would have to audit and remove to avoid accidentally deploying a database alongside the app. Layer hygiene is maintained when the app container and the database are independently lifecycle-managed, mirroring production topology where the database runs separately (RDS, Managed Postgres, etc.). Single-container simplicity is appropriate for the reference implementation; orchestration (multi-container, K8s, etc.) is a downstream concern. The PORT range constraint (6040–6049) is an asp project requirement documented in `docs/brief.md` and enforced by `api/src/lib/config.ts`; platforms injecting `PORT` outside this range require `config.ts` relaxation — out of scope for the reference implementation.

**Consequences:**

1. **Database is external.** Operators must supply a running Postgres instance (separate from compose). Connection details are provided via `DATABASE_URL` environment variable.
2. **HTTPS termination is the platform's responsibility.** The app binds to HTTP; the host platform (reverse proxy, load balancer, container orchestrator) provides TLS termination.
3. **Port constraint is enforced.** Platforms injecting `PORT` outside 6040–6049 will cause `config.ts` startup validation to fail with a ConfigError. No automatic port relaxation is implemented.
4. **Entrypoint dispatch.** The container starts with a shell entrypoint that dispatches to Fastify `start` or a CLI subcommand based on the command argument. Example: `docker run asp:latest migrate` runs the migration CLI; `docker run asp:latest` (or `docker run asp:latest serve`) starts the API server.

**Alternative rejected:** Including a Postgres service in compose. Rejected because it silently introduces a local-infra dependency that would require downstream forks to audit and remove. Separating the database layer improves transparency and matches production topology where the database is independently managed.

**Alternative rejected:** Multi-container orchestration. Rejected because it is out of scope for a reference implementation. Downstream forks are free to orchestrate (K8s, swarm, etc.); the reference implementation is deliberately simple.

---

### ADR-029 — E2E suite runs against production container in CI; unified webServer lifecycle (Phase 13, INFRA-030; updated Phase 21, INFRA-038)

**Status:** Accepted (2026-06-01, Phase 13); updated (2026-06-15, Phase 21)

**Decision:** E2E tests in CI run against the production Docker image (`asp:local`), not dev servers. `playwright.config.ts` declares a single `webServer` block that is always present — in both local and CI runs — with the server-startup command driven by the `CONTAINER_IMAGE` environment variable rather than a `process.env.CI` branch.

**Rationale:** The false-confidence risk: testing an un-built, un-containerised code path (dev servers) diverges from what is deployed (production container). E2E tests exist to verify the deployable artefact — the production container. Running E2E against dev servers masks build-time issues, missing dependencies, or Dockerfile misconfigurations that would only surface after deployment. Aligning E2E with the production container is the canonical "reference runs end-to-end" guarantee for asp. This closes Phase 4.5 lesson (CER-016 — integration tests silently diverging from production).

**Updated mechanism (INFRA-038):** `playwright.config.ts` resolves all server configuration from environment variables with documented defaults. There is no `process.env.CI` branch:

- **`CONTAINER_IMAGE`** — when set (e.g. `asp:local`), the `webServer` command is `docker run --rm --name asp-e2e --network host … <image> serve`. When absent, the command is `pnpm dev` (starts monorepo dev servers).
- **`BASE_URL`** — the `baseURL` Playwright uses for navigation. Defaults to `http://localhost:6040` when `CONTAINER_IMAGE` is set, and `http://localhost:6041` otherwise.
- **`READINESS_URL`** — the URL Playwright polls before any test starts. Defaults to `http://localhost:6040/api/health` when `CONTAINER_IMAGE` is set, or `${BASE_URL}/api/health` otherwise.
- **`reuseExistingServer`** — `false` when `CI` is set (forces a clean start); `true` otherwise (allows local developers to reuse a running server).

The container is started with `--rm` so Docker removes it automatically when the process exits. Playwright's `webServer` lifecycle manages process shutdown for both Docker and `pnpm dev`.

**Impact on local dev:** Developers can run `pnpm test:e2e` without any pre-running server. Playwright starts `pnpm dev`, waits for the readiness URL, runs tests, and terminates the dev servers on completion. To test against a local container image, set `CONTAINER_IMAGE=asp:local` before running.

**CI job:** The `e2e` job in `.github/workflows/ci.yml` runs after the `ci` job:
1. Build the `asp:local` image
2. Run database migrations (via container `migrate` subcommand)
3. Seed reference data
4. Run `pnpm test:e2e` with `CONTAINER_IMAGE=asp:local`, `BASE_URL`, `API_BASE`, and all required env vars set — Playwright starts, waits for, and stops the container
5. On failure, upload the Playwright HTML report as a workflow artifact for debugging

**Alternative rejected:** Testing against dev servers in CI. Rejected because it masks deployment-time issues (missing deps, container build errors) that only surface when the production image is used. The false confidence of a passing E2E suite against dev servers is worse than a failing E2E suite against production.

**Alternative rejected:** Conditional Playwright config via multiple playwright config files. Rejected because it adds file complexity and operational overhead. A single config file driven by environment variables is simpler and centralises all toggles in one readable place.

**Alternative rejected (original):** CI-conditional `webServer` via `process.env.CI`. Rejected (INFRA-038) because it created divergent local/CI preconditions — locally required `pnpm dev` to already be running; CI launched Docker. The `CONTAINER_IMAGE`-driven design gives both contexts a consistent Playwright-owned server lifecycle.

---

### ADR-030 — CI-only console mailer relaxation + CER-015 enforcement matrix closure (Phase 14, INFRA-033/031)

**Status:** Accepted (2026-06-02, Phase 14)

**Decision:** The `MAILER_PROVIDER=console` production guard in `lib/config.ts` is relaxed when `process.env.CI === 'true'`. Additionally, ESLint `no-restricted-imports` now covers `resend` / `resend/*` alongside `@aws-sdk/*` and `@anthropic-ai/sdk` in the `SDK_IMPORT_DENY` rule.

**Rationale for CI relaxation:**

The production image is the E2E system under test (ADR-029). To run the E2E suite against the production container without a live Resend account or API key, the config guard must allow `MAILER_PROVIDER=console` in production when `CI=true`. The `process.env.CI` flag is set by GitHub Actions and similar CI systems; it is never set in an actual production deployment. This preserves the Phase 11 invariant — that real production runtimes never use the console mailer — while enabling the test infrastructure to verify the deployable artefact end-to-end.

**Rationale for rejecting a new provider value:**

An alternative approach would be to introduce a new provider value (e.g., `'log'` or `'test'`) instead of relaxing the `console` guard via `CI`. This was rejected because:
- A new enum value in the public `MAILER_PROVIDER` configuration would appear in documentation and could be adopted in downstream forks without understanding the implication.
- The `CI` flag is intentionally narrower: it is set by the CI system only and has no equivalent in normal deployment workflows. This prevents accidental adoption outside E2E test environments.
- Keeping the relaxation inside the existing `console` branch leaves the guard message grep-able (e.g., `grep -r MAILER_PROVIDER=console` to find all prod uses) and the configuration surface minimal.

**ESLint enforcement closure:**

ADR-027 established `MailerClient` as the single email seam and confined the Resend SDK import to `lib/mailerAdapters/resend.ts`. CER-015 noted that this architectural constraint was enforced only by convention — the ESLint `no-restricted-imports` rule covered `@aws-sdk/*` and `@anthropic-ai/sdk` but not `resend`. INFRA-031 closes this gap by adding `resend` / `resend/*` to the `SDK_IMPORT_DENY` rule in `api/eslint.config.js`. This completes the single-seam enforcement matrix promised in ADR-027: every approved-external-SDK seam is now enforced at lint time, not by convention.

**Consequences:**

1. **Production config remains strict for real deploys.** Any actual production runtime that does not set `CI=true` (which is every real deployment) rejects `MAILER_PROVIDER=console` per the original Phase 11 design. CI systems set `CI=true`, allowing the test suite to run without secrets.
2. **The SDK import seam is now structurally enforced.** All three external SDKs (`@aws-sdk`, `@anthropic-ai/sdk`, `resend`) are covered by the ESLint rule. Future SDK integrations must follow the same pattern: declare the seam file in `lib/` and add the import pattern to `SDK_IMPORT_DENY`.

**Alternative rejected:** Treating the config guard as "CI knows what it's doing" and relaxing `console` unconditionally in production without the `CI` check. Rejected because it would silently allow accidental production deployments without a real mailer, violating the Phase 11 invariant that ensures email reliability in live systems.

---

### ADR-031 — Roster-level PII audit log on every authenticated experience list call (Phase 15, API-027, closes CER-012)

**Status:** Accepted (2026-06-03, Phase 15)

**Decision:** `GET /api/experiences` emits one `pii_access_log` row per authenticated call, regardless of whether any returned experiences have `permissionToContact = true`. The row has `action: 'read'`, `resourceId: null` (roster-level, no single resource), `resourceType: 'experience'`, `subjectUserId` set to the `owner_user_id` query param, and `viaGrant: true` when the caller is not the owner (i.e., a mentor). The existing per-row PII log (fires only when `permissionToContact = true`) is preserved unchanged.

**Rationale (audit completeness over PII-exposure granularity):** A mentor's roster-level access — simply viewing which experiences exist — is itself an auditable event. The prior per-row log captured field-level PII exposure but missed the access attempt itself: a mentor who calls `GET /api/experiences` and receives a list of experiences with all contact fields nulled out (because `permissionToContact = false` on every row) left no trace in the audit log. This gap violated the non-repudiation guarantee the audit log is meant to provide. The new roster-level entry is coarse-grained: it records that the caller queried the list, not that individual PII fields were returned.

**Trade-off:** One extra DB write per list call. The insert is fire-and-forget (same pattern as existing per-row log inserts) — it does not block the response and has no latency impact on the caller. The write cost is acceptable given the audit completeness benefit.

**Alternative rejected:** Extending the per-row log to fire even when `permissionToContact = false`. Rejected because: (a) it would generate N rows per list call (one per experience), inflating the audit log disproportionately, and (b) the per-row log is semantically tied to PII field exposure, not to roster enumeration. A separate coarse-grained row is the correct model.

---

### ADR-032 — Better Auth trustedOrigins must include ALLOWED_ORIGINS for dev-server CSRF compatibility (Phase PM022-main)

**Status:** Accepted (2026-06-22, Phase PM022-main)

**Context:** Better Auth performs an Origin-header CSRF check on authenticated endpoints (`/api/auth/two-factor/enable`, `/api/auth/two-factor/verify-totp`, `/api/auth/sign-out`, and any endpoint that requires a session). In production, the UI and API share the same origin (ADR-024), so the check passes automatically. In dev mode, the Vite dev server (port 6041) proxies `/api` requests to the API (port 6040) — the proxy rewrites the host but the browser sends `Origin: http://localhost:6041`, which does not match the API's own origin. Without explicitly listing this origin in BA's `trustedOrigins`, all CSRF-checked requests from the Vite proxy are rejected with 403.

**Decision:** `buildAuthConfig(isProduction, allowedOrigins?: string[])` in `api/src/services/auth/index.ts` accepts the value of `config.ALLOWED_ORIGINS` (a string array) and passes it as `trustedOrigins: allowedOrigins`. The module-level `auth` instance passes `config.ALLOWED_ORIGINS` at startup. (Before INFRA-052 the parameter was a single `allowedOrigin?` string sourced from `config.ALLOWED_ORIGIN`; INFRA-052 made both the config value and this parameter a comma-separated list / array.)

**Consequence:** Any code that calls `buildAuthConfig(false)` without the second argument will produce a BA instance with `trustedOrigins: []` (the parameter defaults to `[]`). Integration tests that exercise CSRF-checked BA endpoints must either pass a matching `allowedOrigins` array or set the `Origin` header on the request to match the server's own origin.

**Alternative rejected:** Setting `trustedOrigins` to a wildcard or to a fixed `['http://localhost:6041']`. Rejected because wildcard trust would allow any origin to bypass CSRF and a hardcoded localhost value would not survive environment changes. Using `ALLOWED_ORIGINS` keeps trustedOrigins in sync with the CORS allow-list for the environment.

---

### ADR-033 — Dual-mode GET /api/users endpoint (Phase PM025-main, API-029)

**Status:** Accepted (2026-06-24, Phase PM025-main)

**Decision:** `GET /api/users` supports two modes keyed by query params:
- `?email=<prefix>` — typeahead search returning `{ id, email, name }[]` (≤ results, backwards-compatible, unchanged from API-022).
- `?page=N&pageSize=M` — paginated full list returning `{ users, totalCount, page, pageSize }` with enriched shape per user: `{ id, email, name, roles: string[], activeMentorGrantCount: number }`.

The two modes are distinguished in the handler by the presence of `page` in the validated query. Zod `.refine()` enforces that exactly one mode is specified (email OR page+pageSize; neither alone is valid).

**Rationale:** The `UsersAdminPage` needs a richer user list with system roles and active grant counts. Adding a second mode to the existing endpoint avoids adding a new `/api/users/list` route that would duplicate the admin auth gate, making the API surface smaller and the auth boundary easier to audit. Backwards compatibility is preserved: callers using `?email=` continue to receive the exact same response shape.

**Trade-off — single-route dual-mode:** The response type is a discriminated union which makes the Zod schema slightly more complex (`.refine()` + `z.union()` on response). An alternative would be a separate `GET /api/admin/users` route; this was not chosen because the typeahead and list both require `admin` role and logically operate on the same resource.

**Alternative rejected:** New `GET /api/admin/users` route. Rejected because it duplicates the auth gate and adds a new route registration for what is logically the same resource under the same RBAC guard. The dual-mode endpoint keeps the admin boundary consolidated.

---

### ADR-034 — `mentor_grants.requested_by_user_id` + `pending` status value for applicant-initiated requests (Phase PM026-main, DB-020)

**Status:** Accepted (2026-06-24, Phase PM026-main)

**Context:** The PM026 workflow lets applicants initiate their own mentor-grant requests, which an admin then approves. Two schema gaps blocked this: (1) there was no column recording who originated an applicant-initiated request, and (2) the `mentor_grants_status_values` CHECK only permitted `'active'` and `'revoked'` — `pending` (the status of an unapproved applicant request) was never present despite earlier specs assuming otherwise. Both changes ship in a single migration (`0016_glorious_diamondback.sql`) ahead of the API code that reads or writes them.

**Decision:**

1. **New column `requested_by_user_id`** — nullable `text`, a soft reference to `users.id` (no Drizzle FK, per ADR-003). Lifecycle:
   - **NULL** = the grant was created directly by an admin (the existing path; `granted_by_user_id` holds the admin id).
   - **non-null** = the grant originated as an applicant-initiated request; the value is the `users.id` of the applicant who requested it.
   Carries the project-standard 255-char length CHECK `mentor_grants_requested_by_user_id_len` (`length(requested_by_user_id) <= 255`) per ADR-026. Because the column is nullable, the CHECK relies on `length(NULL)` evaluating to NULL (constraint passes for NULL rows) — no explicit `IS NULL OR` guard is required for a `<=` comparison against a NULL-yielding expression.

2. **`pending` added to `mentor_grants_status_values`** — after this migration the CHECK is `status IN ('pending', 'active', 'revoked')`. The column default remains `'active'` (admin-created grants are active immediately); applicant-initiated requests are inserted with `status = 'pending'` by the PM026 request path and transition to `'active'` on admin approval. The migration drops the old two-value CHECK and re-adds the three-value CHECK in one statement group.

**Migration application note:** `asp_test` (the test database) is migrated. The `asp` dev database did not exist on the shared Postgres server at build time; the operator must create it and run `pnpm --filter @asp/api db:migrate` against it (see DEVELOPER ACTION below).

**Why text CHECK, not enum:** Consistent with ADR-022 — `status` is an app-internal control value that may expand; a text CHECK is cheaper to evolve than a Postgres enum (`ALTER TYPE ... ADD VALUE` exclusive-lock DDL). This story is itself an instance of that evolution path.

**Alternative rejected:** Reusing `granted_by_user_id` to record the applicant requester. Rejected because `granted_by_user_id` is NOT NULL and semantically means "the admin who granted/approved the grant"; overloading it to sometimes mean "the applicant who requested" would destroy the audit distinction between request origination and admin approval. A separate nullable column keeps the two actors unambiguous.

---

### ADR-035 — Experience verification lifecycle: unverified by default, mentor-only, reversible (Phase PM027-main, DB-021)

**Status:** Accepted (2026-06-24, Phase PM027-main)

**Decision:** The `experiences` table carries three verification columns:
- `verification_status text NOT NULL DEFAULT 'unverified'` — constrained by CHECK `experiences_verification_status_values` to `'unverified'` or `'verified'`.
- `verified_by_user_id text` — nullable soft reference to `users.id` (no Drizzle FK per ADR-003). 255-char length CHECK `experiences_verified_by_user_id_len` with `IS NULL OR` guard (nullable column per ADR-026 pattern).
- `verified_at timestamptz` — nullable timestamp with time zone; records when the verification was applied.

**Lifecycle:**
1. Every experience is created with `verification_status = 'unverified'` (DB default). No application code is required to set this explicitly.
2. A mentor with an **active** mentor grant for the experience's owner sets `verification_status = 'verified'`, records their own `users.id` in `verified_by_user_id`, and sets `verified_at` to the current timestamp.
3. Verification is **reversible**: a mentor (or admin) may un-verify an experience by setting `verification_status` back to `'unverified'` and nulling `verified_by_user_id` and `verified_at`.
4. **Applicants cannot self-verify.** The write path must enforce this at the API layer: the experience owner is disqualified as a verifier; only a caller whose `users.id` is associated with an active mentor grant covering the applicant may transition the status to `'verified'`.

**Rationale:** Durable, auditable sign-off on applicant experiences is a core mentor-review workflow requirement. Storing the verification state on the `experiences` row keeps the data co-located with the content it describes, avoiding a separate junction table for a single-row, single-state field. The `IS NULL OR` guard on the length CHECK follows the established nullable-column pattern (ADR-026, ADR-013). Reversibility is an explicit design choice: a mistaken or retracted verification should leave no permanent mark. The no-self-verify rule is enforced at the API layer (not the DB layer) because the DB has no direct awareness of the caller's identity.

**Alternative rejected:** A separate `experience_verifications` table. Rejected because verification is a 1:1 relationship per experience (at most one current verification state); a separate table adds a join to every experience read for no normalisation benefit. If the domain later requires a full audit trail of verification history, a `experience_verification_log` append-only table can be added alongside the inline columns.

**CER-012 resolution (API-033):** Mentor verification actions ARE audited. The
`verifyExperience()` write path (`PATCH /api/experiences/:id/verification`) writes a
`pii_access_log` row with `action: 'update'`, `viaGrant: true`, `subjectUserId` set to the
experience owner. This closes the open policy question CER-012 for verification: a mentor
mutating verification state always leaves an audit trace. Mentor read-only access to
fully-gated experiences (where no verification occurs and `permissionToContact = false`)
remains governed by the roster-level read log per ADR-021/ADR-031 — no additional per-field
read log fires when no PII is exposed.

---

### ADR-036 — Canonical underscore-separated action vocabulary for `admin_action_log` (DB-022)

**Status:** Accepted (2026-06-26, Phase PM030-main)

**Decision:** The `admin_action_log.action` column is constrained to exactly six canonical underscore-separated values: `grant_create`, `grant_update`, `grant_review`, `category_create`, `category_update`, `role_change`. A named CHECK constraint `admin_action_log_action_values` enforces this at the DB layer. Prior dotted forms (`grant.create`, `grant.update`, `category.create`, `category.update`) are eliminated — migration `0018_low_eternals.sql` rewrites any legacy rows before adding the constraint.

**Rationale:** The original insertion sites used dotted strings (`grant.create`, `grant.update`, `category.create`, `category.update`) while two others (`grant_review`, `role_change`) used underscore-separated forms. This inconsistency prevented a DB-level value CHECK and made programmatic filtering of the audit log brittle. The canonical form is underscore-separated (consistent with the `pii_access_log.action` vocabulary pattern). A value CHECK closes the gap identified during PM030 mentor-model remediation: any future insertion site that uses an out-of-vocabulary action string will fail at the DB layer, not silently at query time.

**Migration strategy:** Because the DB may hold rows written by earlier code with dotted forms, a bare `ADD CONSTRAINT ... CHECK` would fail validation against existing rows. The migration includes four `UPDATE` statements to rewrite legacy dotted values before the `ADD CONSTRAINT` statement. This follows the "data-migration before schema-constraint" pattern established for `mentor_grants_status_values` in DB-020.

**Alternative rejected:** Keeping dotted forms as the canonical vocabulary. Rejected because the `pii_access_log` precedent uses short, underscore-separated action names (`read`, `create`, `update`, `delete`) and dotted forms introduce parsing ambiguity for consumers that split on `.` or treat them as nested keys. Underscore-separated vocabulary is consistent with the existing `grant_review` and `role_change` values already in production.

---

### ADR-037 — CORS allowed-method restriction (PM031-main)

**Decision.** `@fastify/cors` in `api/src/plugins/cors.ts` enumerates exactly
the HTTP methods the API uses: `GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS`.
`PUT` is deliberately excluded — asp follows the PATCH convention for all
partial updates (no resource is fully replaced via PUT).

**Rationale.** Restricting the allowed-methods list to what is actually used
minimises the CORS attack surface. A browser preflight for an unsupported method
will not receive a permissive `Access-Control-Allow-Methods` header.

**Consequence.** If a future story adds a `PUT` endpoint, this ADR must be
revisited and the `methods` array in `cors.ts` updated explicitly.

**PM036 revisit (API-042):** `PUT /api/admin/readiness-config` was introduced in PM036-main. The CORS methods array was intentionally NOT updated because (1) production uses same-origin serving (ADR-024; CORS does not apply) and (2) the Vite dev proxy uses `changeOrigin: true`, which rewrites the Origin before the API receives it. No cross-origin PUT is possible in either deployment topology. The methods list remains accurate for cross-origin exposure, which is what CORS governs.

---

### ADR-038 — Mentor impact stats are derived, not stored (Phase PM035-main, API-040)

**Status:** Accepted (2026-06-30, Phase PM035-main)

**Decision:** `GET /api/mentor/impact` computes mentor impact statistics (monthHoursVerified, lifetimeHoursVerified, applicantsMentored, avgTurnaroundHours, streakDays, pendingVerifications) by aggregating existing columns from `experiences` (`verifiedByUserId`, `verifiedAt`, `createdAt`, `totalHours`) and `mentor_grants`. No new table or column is added to the schema.

**Rationale:** The impact stats are a pure function of existing verification data. A stored cache would introduce write-path coupling (every experience verification would need to update a cache row) and drift risk (cache invalidation complexity, potential consistency gaps) for no read-latency benefit at current scale. Stats are re-derived on every request with acceptable performance; the cost of a few aggregation queries is lower than the operational burden of cache invalidation and drift.

**Turnaround caveat:** Average turnaround time is calculated as `mean(verifiedAt − createdAt)`. The `createdAt` column is the row-insert time, used as a **proxy for submission time**. There is no separate "submitted at" column. Turnaround is therefore approximate and will skew if an experience is edited long before verification — a user who creates an experience, leaves it dormant for weeks, then edits it and has it verified the same day will appear to have a turnaround window that includes the full dormancy period. This limitation is noted as acceptable for Phase PM035; a true submission timestamp is a future schema addition if precision becomes critical.

**Scope/ABAC:** The endpoint is self-scoped to the authenticated caller (no `subject_user_id` query param — ABAC guarantee). The system role model remains `admin|applicant` (no `mentor` system role); mentorship is purely grant-based (Decision 5, ADR-008). Any authenticated user with an active mentor grant can call `GET /api/mentor/impact` and receive their own stats; the query returns no cross-user data.

**Management surface:** None required. The impact stats are derived read-only statistics with no persistent independent state. No UI form, no admin surface, and no backoffice management are needed — consistent with the schema-gate exception for append-only audit logs (ADR-021).

---

### ADR-039 — Configurable goal hours and single-row readiness-weights config (Phase PM036-main, DB-024/DB-025/API-041/API-042/UI-075/UI-076/UI-077)

**Status:** Accepted (2026-06-30, Phase PM036-main)

**Decision:** Two operator-configurable data mechanisms are introduced in Phase PM036.

1. **Configurable goal hours.** `experience_categories.goal_hours` is a nullable `integer` column (DB-024). `NULL` means "no hour minimum" — the category is excluded from readiness goal-progress calculations and no goal badge is rendered. A value of `0` is structurally valid but semantically meaningless; operators use `NULL` to opt a category out. A CHECK constraint (`goal_hours IS NULL OR goal_hours >= 0`) prevents negative values. The `employment` and `extracurricular-activities` categories, which previously carried placeholder values of `0` from the legacy `vmcasThresholds.ts` map, are seeded with `NULL`. The `goal_hours` field is returned on every category read response (API-041) and is editable in the `CategoriesAdminPage` (UI-075).

2. **Readiness weights as single-row operator config.** A new `readiness_config` table (DB-025) stores the three weights (`w_goal`, `w_verified`, `w_breadth`) that the client uses to compute the readiness score. The table is enforced as a single-row singleton via a CHECK constraint (`id = 'default'`). Default values are `0.6 / 0.25 / 0.15`. Each weight is individually bounds-checked (`[0, 1]`). The admin weights editor (`ReadinessSettingsPage`, UI-076) validates that the live sum is within ±0.001 of 1.0 before enabling Save. The update route is `PUT /api/admin/readiness-config` (API-042).

3. **Readiness remains CLIENT-computed and is NOT persisted** (reaffirms Decision 1 from the original readiness design). The readiness score is derived in `ui/src/lib/readiness.ts` from raw category goal-progress values, verified-ratio, and breadth, weighted by the operator config fetched from `GET /api/admin/readiness-config`. The config is fetched once per session (React Query, `staleTime: Infinity`) and is never embedded in per-experience payloads. No `readiness_score` column exists anywhere in the schema. The client-side derivation swap from the legacy slug→threshold map to the per-category `goalHours` value from the API is implemented in UI-077.

**Rationale:** Goal hours belong on the category because they are category-intrinsic metadata, not applicant state. Operator-editable readiness weights are a natural extension of the single-tenant operator-config philosophy: the system ships with researched defaults and the operator can adjust them without a code deploy. A single-row table is preferred over a key-value config table because the weights are interdependent (they must sum to 1.0), typed (float8 with per-column bound CHECKs), and always read and written atomically. A KV approach would push the cross-field sum validation to the application layer with no DB-level expression index to help.

**Trade-off:** The singleton CHECK pattern (`id = 'default'`) is unusual but proven in asp's schema (see the singleton-row convention). The `PUT /api/admin/readiness-config` endpoint intentionally performs an upsert (`ON CONFLICT (id) DO UPDATE`) so the row is always present after first migration. The weight sum constraint (±0.001 tolerance) is enforced at the API layer (Zod) and UI layer; no DB-level CHECK enforces the cross-column sum because Postgres does not support multi-column CHECKs across float arithmetic with tolerance bounds.

**Alternative rejected:** Storing readiness weights in a generic `operator_settings` KV table was considered and rejected. A KV table would require runtime type coercion, makes cross-field sum validation harder to enforce, and adds no flexibility benefit for a closed three-value config that will not grow without a schema change anyway.

**Known gap:** `PUT /api/admin/readiness-config` is intentionally not audit-logged. The `admin_action_log_action_values` CHECK is closed to exactly six values (DB-022, ADR-036). Extending it to include a `config_update` action is deferred — the weights editor is low-frequency and admin-only; the gap is accepted for Phase PM036.

---

### ADR-040 — Talent pool is grant-scoped ABAC; interview shortlist is reviewer-owned (Phase PM037-main, DB-026/API-043/API-044)

**Status:** Accepted (2026-07-01, Phase PM037-main)

**Decision:** The mentor talent pool (`GET /api/mentor/talent-pool`, API-043) is scoped to the caller's **active** `mentor_grants`. There is **no mentor or selection system role** — `system_roles` remains `admin|applicant`. Applicants holding the `admin` role are excluded from the pool. The endpoint returns **raw readiness components** (per-active-category hours, experience, verified counts; summed totals; activeCategoryCount) — never a persisted readiness score. Ranking is computed **client-side** (consistent with Decision 1, ADR-038). The `interview_shortlist` table (DB-026) is reviewer-owned: composite PK `(reviewer_user_id, applicant_user_id)`, reads isolated to `reviewer_user_id = caller`, writes gated by `hasMentorGrant(caller, applicant, 'read')`. There is **no admin management surface** for shortlist data — reviewers manage their own shortlists via B1/B2 UI (API-044).

**Rationale:** Mentorship is already modelled via `mentor_grants` (ADR-008). Using grant scope for visibility avoids a coarse-grained system role that would conflate many independent mentor relationships into a single role assertion. Grant-based ABAC is finer-grained: each grant establishes a distinct mentor↔applicant relationship; visibility follows the grant, not a role. Reviewer-owned shortlist data (unlike PII access logs, which are audit records) has no admin management need — each reviewer's private star ratings and shortlist flags are tied to their own assessment workflow.

**Consequences:**

1. The per-row enforcement in `listTalentPool()` (API-043) is `mentorUserId = caller AND status = 'active'`. This SQL filter IS the ABAC gate — the query yields only applicants for whom the caller holds an active mentor grant.
2. `interview_shortlist` qualifies for the no-management-surface exception (same precedent as `pii_access_log`, ADR-021). The table is reviewer-private ABAC content, not operator config. Backoffice tools that surface audit or reviewer feedback are out of scope for Phase PM037.
3. The talent-pool response omits `goalHours` per category. Client ranking uses the legacy `goalForSlug` VMCAS slug map as a proxy. Operator-edited category goal hours (DB-025, API-041) do not affect talent-pool ranking in this phase. A future phase should add `goalHours` to each category entry in the talent-pool response to close this inconsistency.

**Alternative rejected:** A global readiness leaderboard / "Top 5%" ranking with read access gated by role. Rejected because it assumes a single shared ranking formula, prevents per-reviewer private assessments, and couples visibility to role rather than to the actual grant relationship that justifies mentor access. A per-grant view with client-side ranking preserves reviewer autonomy and keeps access control aligned with the real business rule: a mentor sees applicants they have an active grant for.

---

### ADR-041 — Milestone persistence, idempotent award worker, and private mentor level (Phase PM038-main, DB-027/API-045/UI-082)

**Status:** Accepted (2026-07-01, Phase PM038-main). **Partially superseded (2026-07-09, Phase PM052-main, API-064)** for hour-threshold milestones: hour milestones (`hours-*`) are no longer maintained as a server↔client lock-step mirror. They are operator-configurable rows in the `milestone_config` table, loaded at runtime by the server and merged with the code-defined structural set; the client receives the fully-evaluated list from `GET /api/me/milestones` and no longer mirrors hour definitions. Structural milestones and the persisted-award / idempotent-worker decisions below remain in force.

**Decision:** PM038 introduces the first persisted gamification state: the `milestone_award` table records earned milestones with an idempotent award worker that fires on the experience lifecycle (create/update/verify). Mentor level (`Gold`/`Platinum`) is derived in the UI from the mentor's own `lifetimeHoursVerified` aggregated from stored verification data; no new table or role is added. The award worker is a **system writer** (no access control of its own; invoked from routes that already authorised the mutation).

**Rationale:**

1. **Stored, not re-derived (Decision 3).** Milestones are persisted in `milestone_award` (DB-027) rather than recomputed per request. This makes `earned_at` a stable historical fact and enables server-confirmed celebration (vs. the PM034 client-debounced strip). The system-of-record for "did the user earn this?" is the database, not a client-side predicate.

2. **Idempotent worker.** `awardMilestones(userId)` is invoked inside `createExperience`, `updateExperience`, and `verifyExperience` in `services/experiences.ts` (API-045). Idempotency is guaranteed by the `(user_id, milestone_key)` UNIQUE constraint + DB `ON CONFLICT DO NOTHING` at insert time. No application-layer idempotency guard is required; the DB constraint is the source of truth.

3. **Canonical set mirrored.** The server milestone set (`api/src/services/milestones.ts`) mirrors the UI definition (`ui/src/lib/milestones.ts` from UI-067). Keys, predicates, labels, and remaining-label functions must stay in lock-step across any schema or definition change. This lock-step obligation is documented in both files and enforced by convention (a future phase may add a lint rule to verify the symmetric definition).

4. **Private mentor level (Decision 6).** The `Gold` / `Platinum` level is derived in the UI from the mentor's own `lifetimeHoursVerified` fetched via `GET /api/mentor/impact` (ADR-038, never stored). Thresholds live in code (`ui/src/lib/mentorLevel.ts`: `PLATINUM_HOURS = 1000`). There is **no leaderboard, ranking, or "Top X%"** copy — the badge is self-referential only, reflecting an individual mentor's own progress. No new `mentor` system role is introduced (Decision 5, ADR-008); mentorship remains grant-based.

5. **Management surface.** The auto-award worker (API-045 invocation sites in `services/experiences.ts`) is the system-writer path. The admin milestone-award audit view (`GET /api/admin/milestone-awards`, UI-081, admin-gated) is the human-inspection surface for operational visibility — operators can audit which milestones have been awarded and when. This satisfies the schema-gate completeness rule (ADR-039, extended in conceptual-rebuild-completeness): the `milestone_award` table has a management surface (the audit view + the worker) and is not invisibly persisted with no way to observe it.

**Consequences:**

1. `awardMilestones()` is awaited in the mutation paths, so the award row exists before the HTTP response is sent (no race condition on the client confirmation).
2. The `api/src/db/schema/milestone-award.ts` schema file exports the `milestoneAward` table and is imported by `db/index.ts` for full-schema tracking.
3. The server milestone definition in `services/milestones.ts` must be kept in lock-step with `ui/src/lib/milestones.ts` (UI-067). Both define `MILESTONE_DEFS` with the same keys, labels, predicates, and remaining-label functions. A mismatch between server and UI definitions will silently produce incorrect milestones or celebration copy.

**Alternative rejected:** Recomputing milestones per request instead of storing them. Rejected because: (a) `earned_at` would not be stable (re-running the predicate later might return different results if the user edits experiences), and (b) server-confirmed celebration requires a persisted record to check against — the UI cannot be the sole system-of-record for gamification state if the server is responsible for authorising the mutations that trigger awards.

---

### ADR-042 — At-most-one active mentor grant per (mentor, applicant) pair enforced by DB partial unique index (Phase PM044-main, DB-029)

**Status:** Accepted (2026-07-06, Phase PM044-main)

**Decision:** A partial unique index (`mentor_grants_active_pair_uq`) is added to the `mentor_grants` table to enforce that at most one active grant may exist for any `(mentor_user_id, applicant_user_id)` pair:

```sql
CREATE UNIQUE INDEX mentor_grants_active_pair_uq
  ON mentor_grants (mentor_user_id, applicant_user_id)
  WHERE status = 'active';
```

The constraint is scoped to `status = 'active'` only. Historical and revoked grants for the same pair are allowed to accumulate without restriction. The index is defined in raw SQL migration `0025_mentor_grants_active_pair_uq.sql` because Drizzle's schema DSL does not support partial indexes.

**Rationale:** Without this constraint, an admin could create multiple concurrent active grants for the same mentor/applicant pair. `hasMentorGrant()` uses `.limit(1)` so reads continue to work with duplicates, but duplicate active rows accumulate silently. Any future logic that assumes at-most-one active grant per pair (revocation, permission updates, conflict detection in `requestMentorGrant`) would behave unpredictably. A database-level partial unique index is race-safe (prevents concurrent admin double-submits) and requires no application-layer guard.

**Consequences:**

1. Attempting to insert a second `active` grant for the same `(mentor_user_id, applicant_user_id)` pair raises a unique-violation error at the DB level. The `requestMentorGrant()` service already handles this conflict (conflict discriminant returned to the caller); admin-grant creation via `createMentorGrant()` will surface a DB error on duplicate active inserts.
2. Revoked grants are unaffected — revoking the current active grant and creating a new one for the same pair remains fully supported.
3. Drizzle's schema DSL does not support partial indexes; the constraint is not reflected in the TypeScript schema. A comment in `api/src/db/schema/roles.ts` documents that the index exists at the database level and where to find the migration.

**Alternative rejected:** Application-layer uniqueness guard (e.g., checking for an existing active grant before insert in `createMentorGrant()`). Rejected because it is susceptible to TOCTOU race conditions on concurrent admin requests and requires coordination between `createMentorGrant()` and `requestMentorGrant()` — the DB-level constraint eliminates both risks atomically.

---

### ADR-043 — `admin_action_log` action vocabulary extended with `category_delete` (Phase PM044-main, DB-030)

**Status:** Accepted (2026-07-06, Phase PM044-main)

**Decision:** The `admin_action_log_action_values` CHECK constraint is widened from six values to seven by adding `'category_delete'`. The migration drops and recreates the CHECK in `0026_admin_action_log_category_delete.sql`. The Drizzle schema in `api/src/db/schema/audit.ts` is updated to match.

**Rationale:** The CHECK constraint is the enforcement point for vocabulary drift in the `admin_action_log` table. Without `'category_delete'` in the allowed set, any attempt to audit an experience-category deletion would be rejected at the DB layer, leaving the delete unrecorded. Audit coverage must include all destructive admin actions; a missing action value creates a silent audit gap.

**Consequences:**

1. An `admin_action_log` INSERT with `action = 'category_delete'` now succeeds. Previously it would have been rejected by the CHECK.
2. API-051 (the story that wires the `category_delete` audit call into the delete route) depends on this story.
3. The Drizzle TypeScript schema and the DB CHECK remain in sync after this migration.

**Alternative rejected:** Adding `'category_delete'` only in application code without migrating the CHECK. Rejected because the DB constraint would continue to reject the INSERT, making the audit call silently fail.

---

### ADR-044 — `mentor_grants.permissions` is a closed vocabulary enforced by array-containment CHECK and Zod enum (Phase PM044-main, DB-031)

**Status:** Accepted (2026-07-06, Phase PM044-main)

**Decision:** `mentor_grants.permissions` accepts only the values `'read'` and `'write'`. Enforcement is applied at two layers: (1) a database CHECK `permissions <@ ARRAY['read','write']::text[]` (migration `0027_mentor_grants_permissions_check.sql`) as the last line of defence; (2) `z.array(z.enum(['read', 'write']))` in the POST and PATCH body schemas in `api/src/routes/mentor-grants.ts` as the first line, returning a user-readable 400 before the DB is reached.

**Rationale:** Before this change, `mentor_grants.permissions` was a bare `text[]` with no value constraint. A value like `'Read'`, `'READ'`, or `'reads'` would be silently stored and never match anything in `hasMentorGrant()`, which compares against exactly `'read'`/`'write'`. The failure mode is a grant that appears configured but confers no access, with no error surfaced anywhere. Enforcing at both the Zod boundary and the DB level eliminates silent no-op grants from typo'd or mis-cased permission strings.

**Consequences:**

1. POST /api/mentor-grants or PATCH /api/mentor-grants/:id with `permissions: ['READ']` (or any non-canonical value) now returns a 400 from Zod before the DB is reached.
2. Any direct-DB INSERT with a permissions value outside `['read', 'write']` is rejected by the array-containment CHECK.
3. The Drizzle schema DSL does not express the CHECK (array-containment is unsupported in the DSL); the constraint is documented via a comment on the `permissions` column in `api/src/db/schema/roles.ts`.

**Alternative rejected:** Normalising values to lowercase in application code without a DB CHECK. Rejected because it relies on every code path applying the normalisation correctly; a direct DB write or future route that skips the helper would silently create no-op grants.

---

### DEVELOPER ACTION pattern

Stories that generate a database migration MUST surface a DEVELOPER ACTION
block in the builder's completion report instructing the operator to run
`pnpm --filter @asp/api db:migrate`. Builders never run migrations
themselves — the remote DB is the operator's responsibility.

---

## Non-negotiables

- `process.env` is read only in `api/src/lib/config.ts` and `api/src/db/index.ts`
  (Phase 2+) — the server-runtime readers — plus all standalone CLI scripts in
  `api/src/scripts/` (and `drizzle.config.ts`) which read `process.env` directly
  as they run outside the Fastify process. The approved seed script
  `api/src/db/seed.uat.ts` is also a direct `process.env` reader (UAT-004); it is
  a standalone CLI that runs outside the Fastify process and follows the same
  pattern as `src/scripts/seed.prod.ts`. ESLint rule enforces this for
  server-runtime code; the allowlist covers the entire `src/scripts/` directory
  so new scripts do not require individual doc or config updates.
  Additionally, `api/src/app.ts` reads `process.env['NODE_ENV']` directly in the
  Fastify constructor call (INFRA-048) to set `logger: false` in test environments.
  This single-variable read is approved because the Fastify instance is constructed
  before `config.ts` validation runs in test setups; no other `process.env` read is
  permitted in `app.ts`.
  **Known defect (INFRA-050):** `api/src/plugins/helmet.ts` reads
  `process.env['NODE_ENV']` directly to gate HSTS. This is an inadvertent spec
  defect — the story spec specified `process.env.NODE_ENV === 'production'`
  directly. Should be migrated to `config.NODE_ENV` (import `config` from
  `'../lib/config.js'`) in a future story. Until then, `helmet.ts` is an
  unapproved `process.env` reader in `plugins/`; do not copy this pattern.
- `UAT` env var (boolean, default false) — when true, registers `GET /api/uat/reset-links` (UAT-005). Must NOT be enabled in production (`NODE_ENV=production` causes config to throw at startup). `UAT=false` and `UAT=0` both yield `config.UAT === false` — safe to set defensively without enabling the gate. Set to `true` in `e2e/.env.uat` for UAT harness sessions only. (UAT-012 closed the z.coerce.boolean() coercion footgun.)
- `api/src/app.ts` → `buildApp()` performs NO I/O. Verified by `app.test.ts`.
- `api/src/index.ts` → boot and signal handlers only. Verified by
  `index-shape.test.ts` (grep-based structural test).
- `SESSION_SECRET` ≥64 chars validated at startup. Startup exits non-zero
  with `ConfigError` naming the variable.
- `ALLOWED_ORIGINS` always required (comma-separated allow-list; legacy `ALLOWED_ORIGIN` honoured as a fallback). Startup exits non-zero if unset or empty.
  Normalised to canonical form (trailing slash stripped, default port dropped).
- `SESSION_DURATION_HOURS` — session lifetime in hours, default 168 (7 days). Passed to Better Auth as `session.expiresIn` in seconds. INFRA-051.
- Rate limiting: three per-group caps `RATE_LIMIT_MAX_AUTH` (default 10, covers sign-in/sign-up/password-reset/change-password), `RATE_LIMIT_MAX_MFA` (default 10, covers verify-totp), `RATE_LIMIT_MAX_API` (default 30, covers experiences/mentor-grant-requests), all sharing `RATE_LIMIT_WINDOW_MS` (default 60 000 ms). Groups use isolated keyGenerator counters. INFRA-053.
- `MFA_ENABLED=false` is rejected in `NODE_ENV=production` at config layer.
  This gate exists from Phase 1, before Better Auth is wired.
- All asp dev servers bind in port range 6040–6049.
- UI never imports runtime code from `api/`. `ui/src/api-types.ts` is generated from the OpenAPI spec via `pnpm --filter @asp/api generate:openapi && pnpm --filter @asp/ui generate:types` and committed; CI drift check enforces no divergence (API-014). Local variant uses `--env-file=.env.local`; CI uses `generate:openapi:ci` (plain tsx, env vars from runner). The reviewer continues to verify no runtime `api/` imports exist in `ui/`.
- Drizzle schema (`api/src/db/schema/`) is PROTECTED from Phase 2 onward.
