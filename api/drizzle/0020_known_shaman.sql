ALTER TABLE "experience_categories" ADD COLUMN "goal_hours" integer;--> statement-breakpoint
ALTER TABLE "experience_categories" ADD CONSTRAINT "experience_categories_goal_hours_nonneg" CHECK ("experience_categories"."goal_hours" IS NULL OR "experience_categories"."goal_hours" >= 0);--> statement-breakpoint
UPDATE "experience_categories" SET "goal_hours" = 1000 WHERE "slug" = 'patient-care-experience';--> statement-breakpoint
UPDATE "experience_categories" SET "goal_hours" = 500  WHERE "slug" = 'healthcare-experience';--> statement-breakpoint
UPDATE "experience_categories" SET "goal_hours" = 300  WHERE "slug" = 'volunteer-experience';--> statement-breakpoint
UPDATE "experience_categories" SET "goal_hours" = 300  WHERE "slug" = 'research-experience';