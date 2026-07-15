ALTER TABLE "admin_action_log" DROP CONSTRAINT "admin_action_log_action_values";--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "major" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "gpa" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "portfolio_url" text;--> statement-breakpoint
ALTER TABLE "admin_action_log" ADD CONSTRAINT "admin_action_log_action_values" CHECK ("admin_action_log"."action" IN ('grant_create','grant_update','grant_review','category_create','category_update','category_delete','role_change'));--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_major_len" CHECK ("user_profiles"."major" IS NULL OR char_length("user_profiles"."major") <= 128);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_gpa_len" CHECK ("user_profiles"."gpa" IS NULL OR char_length("user_profiles"."gpa") <= 8);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_phone_e164" CHECK ("user_profiles"."phone" IS NULL OR "user_profiles"."phone" ~ '^\+[1-9]\d{1,14}$');--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_linkedin_url_len" CHECK ("user_profiles"."linkedin_url" IS NULL OR char_length("user_profiles"."linkedin_url") <= 256);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_portfolio_url_len" CHECK ("user_profiles"."portfolio_url" IS NULL OR char_length("user_profiles"."portfolio_url") <= 256);