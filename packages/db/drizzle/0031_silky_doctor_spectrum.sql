CREATE TABLE "oauth_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"app_user_id" uuid NOT NULL,
	"public_teams" boolean DEFAULT true NOT NULL,
	"scopes" text[] NOT NULL,
	"installed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	CONSTRAINT "oauth_installation_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "oauth_installation_app_user_id_unique" UNIQUE("app_user_id")
);
--> statement-breakpoint
ALTER TABLE "oauth_installation" ADD CONSTRAINT "oauth_installation_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_installation" ADD CONSTRAINT "oauth_installation_app_user_id_user_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_installation" ADD CONSTRAINT "oauth_installation_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;