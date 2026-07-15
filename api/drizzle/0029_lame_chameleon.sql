CREATE TABLE "flag_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"experience_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "flag_report_reviewer_len" CHECK (char_length("flag_report"."reviewer_user_id") <= 255),
	CONSTRAINT "flag_report_reason_len" CHECK (char_length("flag_report"."reason") <= 1024),
	CONSTRAINT "flag_report_status_values" CHECK ("flag_report"."status" IN ('open', 'resolved')),
	CONSTRAINT "flag_report_resolved_by_len" CHECK ("flag_report"."resolved_by_user_id" IS NULL OR char_length("flag_report"."resolved_by_user_id") <= 255)
);
--> statement-breakpoint
ALTER TABLE "user_profiles" DROP CONSTRAINT "user_profiles_phone_e164";--> statement-breakpoint
CREATE INDEX "flag_report_experience_idx" ON "flag_report" USING btree ("experience_id");--> statement-breakpoint
CREATE INDEX "flag_report_reviewer_idx" ON "flag_report" USING btree ("reviewer_user_id");--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_phone_e164" CHECK ("user_profiles"."phone" IS NULL OR "user_profiles"."phone" ~ '^\+[1-9]\d{1,14}$');