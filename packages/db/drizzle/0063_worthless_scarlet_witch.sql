CREATE TABLE "favorite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"parent_id" uuid,
	"folder_name" text,
	"sort_order" double precision NOT NULL,
	"predefined_view_type" text,
	"issue_id" uuid,
	"project_id" uuid,
	"custom_view_id" uuid,
	"cycle_id" uuid,
	"document_id" uuid,
	"label_id" uuid,
	"project_label_id" uuid,
	"customer_id" uuid,
	"dashboard_id" uuid,
	"team_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_one_target_check" CHECK (num_nonnulls("favorite"."folder_name", "favorite"."predefined_view_type", "favorite"."issue_id", "favorite"."project_id", "favorite"."custom_view_id", "favorite"."cycle_id", "favorite"."document_id", "favorite"."label_id", "favorite"."project_label_id", "favorite"."customer_id", "favorite"."dashboard_id", "favorite"."user_id", CASE WHEN "favorite"."predefined_view_type" IS NULL THEN "favorite"."team_id" END) = 1),
	CONSTRAINT "favorite_folder_parent_check" CHECK ("favorite"."folder_name" IS NULL OR "favorite"."parent_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_parent_id_favorite_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."favorite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_custom_view_id_team_view_id_fk" FOREIGN KEY ("custom_view_id") REFERENCES "public"."team_view"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_project_label_id_project_label_id_fk" FOREIGN KEY ("project_label_id") REFERENCES "public"."project_label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_dashboard_id_dashboard_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboard"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favorite_owner_idx" ON "favorite" USING btree ("owner_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_issue_uq" ON "favorite" USING btree ("owner_id","issue_id") WHERE "favorite"."issue_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_project_uq" ON "favorite" USING btree ("owner_id","project_id") WHERE "favorite"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_custom_view_uq" ON "favorite" USING btree ("owner_id","custom_view_id") WHERE "favorite"."custom_view_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_cycle_uq" ON "favorite" USING btree ("owner_id","cycle_id") WHERE "favorite"."cycle_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_document_uq" ON "favorite" USING btree ("owner_id","document_id") WHERE "favorite"."document_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_label_uq" ON "favorite" USING btree ("owner_id","label_id") WHERE "favorite"."label_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_project_label_uq" ON "favorite" USING btree ("owner_id","project_label_id") WHERE "favorite"."project_label_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_customer_uq" ON "favorite" USING btree ("owner_id","customer_id") WHERE "favorite"."customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_dashboard_uq" ON "favorite" USING btree ("owner_id","dashboard_id") WHERE "favorite"."dashboard_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_user_uq" ON "favorite" USING btree ("owner_id","user_id") WHERE "favorite"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_team_uq" ON "favorite" USING btree ("owner_id","team_id") WHERE "favorite"."team_id" IS NOT NULL AND "favorite"."predefined_view_type" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_owner_predefined_uq" ON "favorite" USING btree ("owner_id","predefined_view_type",coalesce("team_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "favorite"."predefined_view_type" IS NOT NULL;