CREATE TABLE "template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"type" text DEFAULT 'issue' NOT NULL,
	"team_id" uuid,
	"template_data" jsonb NOT NULL,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"creator_id" uuid,
	"last_updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "template_type_check" CHECK ("template"."type" = 'issue'),
	CONSTRAINT "template_name_check" CHECK (btrim("template"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_last_updated_by_id_user_id_fk" FOREIGN KEY ("last_updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_team_idx" ON "template" USING btree ("team_id");