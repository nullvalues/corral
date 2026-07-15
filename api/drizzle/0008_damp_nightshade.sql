ALTER TABLE "experiences" ADD COLUMN "state_province" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "state_province_code" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "country_iso2" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "country_iso3" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_state_province_len" CHECK ("experiences"."state_province" IS NULL OR char_length("experiences"."state_province") <= 128);--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_state_province_code_len" CHECK ("experiences"."state_province_code" IS NULL OR char_length("experiences"."state_province_code") <= 8);--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_country_len" CHECK ("experiences"."country" IS NULL OR char_length("experiences"."country") <= 128);--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_country_iso2_len" CHECK ("experiences"."country_iso2" IS NULL OR char_length("experiences"."country_iso2") = 2);--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_country_iso3_len" CHECK ("experiences"."country_iso3" IS NULL OR char_length("experiences"."country_iso3") = 3);