CREATE TABLE "workspace_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"team_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL,
	CONSTRAINT "workspace_invite_token_unique" UNIQUE("token"),
	CONSTRAINT "workspace_invite_email_unique" UNIQUE("email"),
	CONSTRAINT "workspace_invite_role_check" CHECK ("workspace_invite"."role" IN ('admin', 'member', 'guest'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_invite" ADD CONSTRAINT "workspace_invite_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;