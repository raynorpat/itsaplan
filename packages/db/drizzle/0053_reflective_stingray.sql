CREATE TABLE "form_settings" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"link_enabled" boolean DEFAULT false NOT NULL,
	"board_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_settings_slug_unique" UNIQUE("slug"),
	CONSTRAINT "form_settings_slug_check" CHECK ("form_settings"."slug" ~ '^[a-z0-9-]{1,48}$')
);
--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "portal_source_board_id" uuid;--> statement-breakpoint
ALTER TABLE "form_settings" ADD CONSTRAINT "form_settings_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_portal_source_board_id_portal_board_id_fk" FOREIGN KEY ("portal_source_board_id") REFERENCES "public"."portal_board"("id") ON DELETE set null ON UPDATE no action;