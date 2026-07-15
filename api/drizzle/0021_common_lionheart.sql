CREATE TABLE "readiness_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"w_goal" double precision DEFAULT 0.6 NOT NULL,
	"w_verified" double precision DEFAULT 0.25 NOT NULL,
	"w_breadth" double precision DEFAULT 0.15 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "readiness_config_singleton" CHECK ("readiness_config"."id" = 'default'),
	CONSTRAINT "readiness_config_w_goal_bounds" CHECK ("readiness_config"."w_goal" >= 0 AND "readiness_config"."w_goal" <= 1),
	CONSTRAINT "readiness_config_w_verified_bounds" CHECK ("readiness_config"."w_verified" >= 0 AND "readiness_config"."w_verified" <= 1),
	CONSTRAINT "readiness_config_w_breadth_bounds" CHECK ("readiness_config"."w_breadth" >= 0 AND "readiness_config"."w_breadth" <= 1)
);
--> statement-breakpoint
INSERT INTO "readiness_config" ("id", "w_goal", "w_verified", "w_breadth")
VALUES ('default', 0.6, 0.25, 0.15)
ON CONFLICT ("id") DO NOTHING;
