CREATE TABLE "project_update_share" (
	"project_update_id" uuid PRIMARY KEY NOT NULL,
	"shared_by_id" uuid,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_update_share" ADD CONSTRAINT "project_update_share_project_update_id_project_update_id_fk" FOREIGN KEY ("project_update_id") REFERENCES "public"."project_update"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_update_share" ADD CONSTRAINT "project_update_share_shared_by_id_user_id_fk" FOREIGN KEY ("shared_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_update_share_shared_at_idx" ON "project_update_share" USING btree ("shared_at");