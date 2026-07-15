ALTER TABLE "experiences" ADD CONSTRAINT "experiences_owner_user_id_len" CHECK (char_length("experiences"."owner_user_id") <= 255);--> statement-breakpoint
ALTER TABLE "mentor_grants" ADD CONSTRAINT "mentor_grants_mentor_user_id_len" CHECK (char_length("mentor_grants"."mentor_user_id") <= 255);--> statement-breakpoint
ALTER TABLE "mentor_grants" ADD CONSTRAINT "mentor_grants_applicant_user_id_len" CHECK (char_length("mentor_grants"."applicant_user_id") <= 255);--> statement-breakpoint
ALTER TABLE "mentor_grants" ADD CONSTRAINT "mentor_grants_granted_by_user_id_len" CHECK (char_length("mentor_grants"."granted_by_user_id") <= 255);--> statement-breakpoint
ALTER TABLE "system_roles" ADD CONSTRAINT "system_roles_user_id_len" CHECK (char_length("system_roles"."user_id") <= 255);