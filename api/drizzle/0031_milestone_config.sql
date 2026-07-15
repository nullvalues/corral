CREATE TABLE "milestone_config" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"threshold_hours" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "milestone_config_key_len" CHECK (char_length("milestone_config"."key") <= 64),
	CONSTRAINT "milestone_config_label_len" CHECK (char_length("milestone_config"."label") <= 128),
	CONSTRAINT "milestone_config_threshold_hours_pos" CHECK ("milestone_config"."threshold_hours" > 0)
);
--> statement-breakpoint
INSERT INTO "milestone_config" ("key", "label", "threshold_hours", "is_active", "sort_order") VALUES
	('hours-100', '100 hours', 100, true, 1),
	('hours-500', '500 hours', 500, true, 2),
	('hours-1000', '1000 hours', 1000, true, 3)
ON CONFLICT ("key") DO NOTHING;
