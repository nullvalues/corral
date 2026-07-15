CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"school" text,
	"graduation_year" smallint,
	"bio" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_school_len" CHECK ("user_profiles"."school" IS NULL OR char_length("user_profiles"."school") <= 256),
	CONSTRAINT "user_profiles_grad_year_range" CHECK ("user_profiles"."graduation_year" IS NULL OR ("user_profiles"."graduation_year" >= 2000 AND "user_profiles"."graduation_year" <= 2100)),
	CONSTRAINT "user_profiles_bio_len" CHECK ("user_profiles"."bio" IS NULL OR char_length("user_profiles"."bio") <= 500)
);
