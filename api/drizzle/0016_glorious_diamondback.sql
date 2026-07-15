ALTER TABLE "mentor_grants" DROP CONSTRAINT "mentor_grants_status_values";--> statement-breakpoint
ALTER TABLE "mentor_grants" ADD COLUMN "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "mentor_grants" ADD CONSTRAINT "mentor_grants_requested_by_user_id_len" CHECK (length("mentor_grants"."requested_by_user_id") <= 255);--> statement-breakpoint
ALTER TABLE "mentor_grants" ADD CONSTRAINT "mentor_grants_status_values" CHECK ("mentor_grants"."status" IN ('pending', 'active', 'revoked'));