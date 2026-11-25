CREATE TABLE "issue_to_release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_id" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"description" text,
	"commit_sha" text,
	"repository" jsonb,
	"start_date" date,
	"target_date" date,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"creator_id" uuid,
	"archived_at" timestamp with time zone,
	"trashed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_slug_id_unique" UNIQUE("slug_id")
);
--> statement-breakpoint
CREATE TABLE "release_access_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"creator_id" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_access_key_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "release_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_id" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"title" text,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_note_slug_id_unique" UNIQUE("slug_id")
);
--> statement-breakpoint
CREATE TABLE "release_note_release" (
	"note_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	CONSTRAINT "release_note_release_note_id_release_id_pk" PRIMARY KEY("note_id","release_id")
);
--> statement-breakpoint
CREATE TABLE "release_pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'continuous' NOT NULL,
	"is_production" boolean DEFAULT true NOT NULL,
	"include_path_patterns" text[] DEFAULT '{}'::text[] NOT NULL,
	"rollover_issues_on_completion" boolean DEFAULT true NOT NULL,
	"auto_generate_release_notes_on_completion" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"trashed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_pipeline_slug_id_unique" UNIQUE("slug_id"),
	CONSTRAINT "release_pipeline_type_check" CHECK ("release_pipeline"."type" IN ('continuous', 'scheduled'))
);
--> statement-breakpoint
CREATE TABLE "release_pipeline_team" (
	"pipeline_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "release_pipeline_team_pipeline_id_team_id_pk" PRIMARY KEY("pipeline_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "release_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"type" text NOT NULL,
	"position" double precision NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_stage_type_check" CHECK ("release_stage"."type" IN ('planned', 'started', 'completed', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "requester_shipped" (
	"requester_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requester_shipped_requester_id_issue_id_release_id_pk" PRIMARY KEY("requester_id","issue_id","release_id")
);
--> statement-breakpoint
ALTER TABLE "issue_to_release" ADD CONSTRAINT "issue_to_release_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_to_release" ADD CONSTRAINT "issue_to_release_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_pipeline_id_release_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."release_pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_stage_id_release_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."release_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_access_key" ADD CONSTRAINT "release_access_key_pipeline_id_release_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."release_pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_access_key" ADD CONSTRAINT "release_access_key_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_document" ADD CONSTRAINT "release_document_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_link" ADD CONSTRAINT "release_link_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_note" ADD CONSTRAINT "release_note_pipeline_id_release_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."release_pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_note_release" ADD CONSTRAINT "release_note_release_note_id_release_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."release_note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_note_release" ADD CONSTRAINT "release_note_release_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_pipeline_team" ADD CONSTRAINT "release_pipeline_team_pipeline_id_release_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."release_pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_pipeline_team" ADD CONSTRAINT "release_pipeline_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_stage" ADD CONSTRAINT "release_stage_pipeline_id_release_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."release_pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requester_shipped" ADD CONSTRAINT "requester_shipped_requester_id_external_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."external_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requester_shipped" ADD CONSTRAINT "requester_shipped_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requester_shipped" ADD CONSTRAINT "requester_shipped_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_to_release_uq" ON "issue_to_release" USING btree ("issue_id","release_id");--> statement-breakpoint
CREATE INDEX "issue_to_release_release_idx" ON "issue_to_release" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_pipeline_idx" ON "release" USING btree ("pipeline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_pipeline_version_uq" ON "release" USING btree ("pipeline_id","version") WHERE "release"."version" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "release_access_key_pipeline_idx" ON "release_access_key" USING btree ("pipeline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_document_uq" ON "release_document" USING btree ("release_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "release_link_uq" ON "release_link" USING btree ("release_id","url");--> statement-breakpoint
CREATE INDEX "release_note_pipeline_idx" ON "release_note" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "release_note_release_release_idx" ON "release_note_release" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_pipeline_team_team_idx" ON "release_pipeline_team" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "release_stage_pipeline_idx" ON "release_stage" USING btree ("pipeline_id");