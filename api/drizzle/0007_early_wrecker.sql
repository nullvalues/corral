ALTER TABLE "experiences" ADD COLUMN "total_hours" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "hours_per_week" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "number_of_weeks" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_hours_triple" CHECK ("experiences"."total_hours" = "experiences"."hours_per_week" * "experiences"."number_of_weeks");--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_total_hours_bounds" CHECK ("experiences"."total_hours" > 0 AND "experiences"."total_hours" <= 100000);--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_hpw_bounds" CHECK ("experiences"."hours_per_week" > 0 AND "experiences"."hours_per_week" <= 168);--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_weeks_bounds" CHECK ("experiences"."number_of_weeks" > 0);