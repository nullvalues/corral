CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"organization" text NOT NULL,
	"position" text NOT NULL,
	"frequency" "frequency_of_experience",
	"start_date" date NOT NULL,
	"end_date" date,
	"duties_narrative" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_category_id_experience_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."experience_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiences_owner_idx" ON "experiences" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "experiences_category_idx" ON "experiences" USING btree ("category_id");