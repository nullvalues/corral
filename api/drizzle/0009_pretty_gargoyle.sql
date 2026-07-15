ALTER TABLE "experiences" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "received_academic_credit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "received_salary_or_payment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "is_volunteer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "is_most_important" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "permission_to_contact" boolean DEFAULT false NOT NULL;