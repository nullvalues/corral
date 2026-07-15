CREATE TABLE "system_roles" (
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "system_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
