CREATE TABLE "portal_board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"team_id" uuid,
	"project_id" uuid,
	"label_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"access" text DEFAULT 'public' NOT NULL,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"show_description" boolean DEFAULT false NOT NULL,
	"comments" text DEFAULT 'portal' NOT NULL,
	"suggestions_enabled" boolean DEFAULT false NOT NULL,
	"suggestion_team_id" uuid,
	"suggestion_state_id" uuid,
	"suggestion_label_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_board_slug_check" CHECK ("portal_board"."slug" ~ '^[a-z0-9-]{1,48}$'),
	CONSTRAINT "portal_board_scope_check" CHECK (("portal_board"."team_id" IS NULL) <> ("portal_board"."project_id" IS NULL)),
	CONSTRAINT "portal_board_access_check" CHECK ("portal_board"."access" IN ('public', 'restricted')),
	CONSTRAINT "portal_board_comments_check" CHECK ("portal_board"."comments" IN ('portal', 'all'))
);
--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "external_user_id" uuid;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "portal_board_id" uuid;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "portal_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "external_user_creator_id" uuid;--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_suggestion_team_id_team_id_fk" FOREIGN KEY ("suggestion_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_suggestion_state_id_workflow_state_id_fk" FOREIGN KEY ("suggestion_state_id") REFERENCES "public"."workflow_state"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_suggestion_label_id_label_id_fk" FOREIGN KEY ("suggestion_label_id") REFERENCES "public"."label"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_board_slug_uq" ON "portal_board" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_external_user_id_external_user_id_fk" FOREIGN KEY ("external_user_id") REFERENCES "public"."external_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_portal_board_id_portal_board_id_fk" FOREIGN KEY ("portal_board_id") REFERENCES "public"."portal_board"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_external_user_creator_id_external_user_id_fk" FOREIGN KEY ("external_user_creator_id") REFERENCES "public"."external_user"("id") ON DELETE set null ON UPDATE no action;