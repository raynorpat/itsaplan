CREATE TABLE "issue_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"status" text NOT NULL,
	"progress" real,
	"team_id" uuid,
	"team_name" text,
	"creator_id" uuid,
	"display_name" text NOT NULL,
	"service_metadata" jsonb,
	"mapping" jsonb,
	"summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "issue_import_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_import" ADD CONSTRAINT "issue_import_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_import" ADD CONSTRAINT "issue_import_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_issue_import_id_issue_import_id_fk" FOREIGN KEY ("issue_import_id") REFERENCES "public"."issue_import"("id") ON DELETE set null ON UPDATE no action;