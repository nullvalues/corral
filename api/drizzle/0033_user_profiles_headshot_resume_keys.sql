ALTER TABLE "user_profiles" ADD COLUMN "headshot_key" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "resume_key" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_headshot_key_len" CHECK ("user_profiles"."headshot_key" IS NULL OR char_length("user_profiles"."headshot_key") <= 512);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_resume_key_len" CHECK ("user_profiles"."resume_key" IS NULL OR char_length("user_profiles"."resume_key") <= 512);