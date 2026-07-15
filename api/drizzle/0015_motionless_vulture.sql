CREATE TABLE "admin_action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_action_log_actor_len" CHECK (char_length("admin_action_log"."actor_user_id") <= 255),
	CONSTRAINT "admin_action_log_action_len" CHECK (char_length("admin_action_log"."action") <= 64),
	CONSTRAINT "admin_action_log_resource_type_len" CHECK (char_length("admin_action_log"."resource_type") <= 64),
	CONSTRAINT "admin_action_log_resource_id_len" CHECK (char_length("admin_action_log"."resource_id") <= 255)
);
