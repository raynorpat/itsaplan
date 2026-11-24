CREATE TABLE "workflow_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_id" text DEFAULT substr(md5(gen_random_uuid()::text), 1, 12) NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"type" text DEFAULT 'automation' NOT NULL,
	"trigger_type" text DEFAULT 'issue' NOT NULL,
	"trigger" text NOT NULL,
	"activation_mode" text,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"edit_access" text DEFAULT 'teamOwners' NOT NULL,
	"owner_user_id" uuid,
	"creator_user_id" uuid,
	"updated_by_user_id" uuid,
	"last_executed_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{"runs":0}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_definition_slug_id_unique" UNIQUE("slug_id"),
	CONSTRAINT "workflow_definition_type_check" CHECK ("workflow_definition"."type" = 'automation'),
	CONSTRAINT "workflow_definition_trigger_type_check" CHECK ("workflow_definition"."trigger_type" = 'issue'),
	CONSTRAINT "workflow_definition_trigger_check" CHECK ("workflow_definition"."trigger" IN ('entityCreated', 'entityUpdated')),
	CONSTRAINT "workflow_definition_edit_access_check" CHECK ("workflow_definition"."edit_access" IN ('everyone', 'teamOwners', 'workspaceAdmins', 'owner'))
);
--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "workflow_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "workflow_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_definition" ADD CONSTRAINT "workflow_definition_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definition" ADD CONSTRAINT "workflow_definition_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definition" ADD CONSTRAINT "workflow_definition_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definition" ADD CONSTRAINT "workflow_definition_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_definition_team_idx" ON "workflow_definition" USING btree ("team_id","sort_order");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_workflow_definition_id_workflow_definition_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definition"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_workflow_definition_id_workflow_definition_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definition"("id") ON DELETE set null ON UPDATE no action;