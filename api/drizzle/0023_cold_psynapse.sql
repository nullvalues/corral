CREATE TABLE "milestone_award" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"milestone_key" text NOT NULL,
	"earned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_award_user_key_uq" UNIQUE("user_id","milestone_key"),
	CONSTRAINT "milestone_award_user_id_len" CHECK (char_length("milestone_award"."user_id") <= 255),
	CONSTRAINT "milestone_award_key_len" CHECK (char_length("milestone_award"."milestone_key") <= 64)
);
--> statement-breakpoint
CREATE INDEX "milestone_award_user_idx" ON "milestone_award" USING btree ("user_id");