CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY DEFAULT 'instance' NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_single_check" CHECK ("ai_settings"."id" = 'instance')
);
--> statement-breakpoint
CREATE TABLE "portal_summary_cache" (
	"requester_id" uuid PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"text" text
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_summary_cache" ADD CONSTRAINT "portal_summary_cache_requester_id_external_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."external_user"("id") ON DELETE cascade ON UPDATE no action;