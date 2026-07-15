CREATE TABLE "mentor_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"applicant_user_id" text NOT NULL,
	"mentor_user_id" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL
);
