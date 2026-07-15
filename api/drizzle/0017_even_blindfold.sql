ALTER TABLE "experiences" ADD COLUMN "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "verified_by_user_id" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_verification_status_values" CHECK ("experiences"."verification_status" IN ('unverified', 'verified'));--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_verified_by_user_id_len" CHECK ("experiences"."verified_by_user_id" IS NULL OR char_length("experiences"."verified_by_user_id") <= 255);