CREATE TABLE "experience_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "experience_categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "experience_categories_slug_format" CHECK ("experience_categories"."slug" ~ '^[a-z][a-z0-9-]{0,63}$'),
	CONSTRAINT "experience_categories_name_len" CHECK (char_length("experience_categories"."name") <= 128)
);
