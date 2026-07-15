CREATE TABLE "pii_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"subject_user_id" text,
	"via_grant" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pii_access_log_action_values" CHECK ("pii_access_log"."action" IN ('read','create','update','delete')),
	CONSTRAINT "pii_access_log_actor_len" CHECK (char_length("pii_access_log"."actor_user_id") <= 255),
	CONSTRAINT "pii_access_log_resource_type_len" CHECK (char_length("pii_access_log"."resource_type") <= 64),
	CONSTRAINT "pii_access_log_subject_len" CHECK ("pii_access_log"."subject_user_id" IS NULL OR char_length("pii_access_log"."subject_user_id") <= 255)
);
--> statement-breakpoint
CREATE INDEX "pii_access_log_subject_idx" ON "pii_access_log" USING btree ("subject_user_id");