ALTER TABLE "experiences" ADD COLUMN "contact_title" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "contact_first_name" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "contact_last_name" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_contact_phone_e164" CHECK ("experiences"."contact_phone" IS NULL OR "experiences"."contact_phone" ~ '^\+[1-9]\d{1,14}$');