CREATE TABLE "project_relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'dependency' NOT NULL,
	"project_id" uuid NOT NULL,
	"anchor_type" text NOT NULL,
	"project_milestone_id" uuid,
	"related_project_id" uuid NOT NULL,
	"related_anchor_type" text NOT NULL,
	"related_project_milestone_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_relation_type_check" CHECK ("project_relation"."type" = 'dependency'),
	CONSTRAINT "project_relation_anchor_check" CHECK ("project_relation"."anchor_type" IN ('start', 'end', 'milestone') AND "project_relation"."related_anchor_type" IN ('start', 'end', 'milestone')),
	CONSTRAINT "project_relation_milestone_check" CHECK (("project_relation"."anchor_type" = 'milestone') = ("project_relation"."project_milestone_id" IS NOT NULL) AND ("project_relation"."related_anchor_type" = 'milestone') = ("project_relation"."related_project_milestone_id" IS NOT NULL)),
	CONSTRAINT "project_relation_not_self" CHECK ("project_relation"."project_id" <> "project_relation"."related_project_id")
);
--> statement-breakpoint
ALTER TABLE "view_preferences" DROP CONSTRAINT "view_preferences_view_type_check";--> statement-breakpoint
ALTER TABLE "project_relation" ADD CONSTRAINT "project_relation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_relation" ADD CONSTRAINT "project_relation_project_milestone_id_project_milestone_id_fk" FOREIGN KEY ("project_milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_relation" ADD CONSTRAINT "project_relation_related_project_id_project_id_fk" FOREIGN KEY ("related_project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_relation" ADD CONSTRAINT "project_relation_related_project_milestone_id_project_milestone_id_fk" FOREIGN KEY ("related_project_milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_relation" ADD CONSTRAINT "project_relation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_relation_anchors_uq" ON "project_relation" USING btree ("project_id","anchor_type",coalesce("project_milestone_id", '00000000-0000-0000-0000-000000000000'::uuid),"related_project_id","related_anchor_type",coalesce("related_project_milestone_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "project_relation_related_idx" ON "project_relation" USING btree ("related_project_id");--> statement-breakpoint
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_view_type_check" CHECK ("view_preferences"."custom_view_id" IS NOT NULL OR ("view_preferences"."type" = 'user' AND "view_preferences"."view_type" IN ('allIssues', 'project', 'cycle', 'myIssues', 'projects')));