CREATE TABLE "interview_shortlist" (
	"reviewer_user_id" text NOT NULL,
	"applicant_user_id" text NOT NULL,
	"star_rating" integer,
	"shortlisted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "interview_shortlist_reviewer_user_id_applicant_user_id_pk" PRIMARY KEY("reviewer_user_id","applicant_user_id"),
	CONSTRAINT "interview_shortlist_star_rating_bounds" CHECK ("interview_shortlist"."star_rating" IS NULL OR ("interview_shortlist"."star_rating" >= 0 AND "interview_shortlist"."star_rating" <= 5)),
	CONSTRAINT "interview_shortlist_reviewer_user_id_len" CHECK (char_length("interview_shortlist"."reviewer_user_id") <= 255),
	CONSTRAINT "interview_shortlist_applicant_user_id_len" CHECK (char_length("interview_shortlist"."applicant_user_id") <= 255)
);
