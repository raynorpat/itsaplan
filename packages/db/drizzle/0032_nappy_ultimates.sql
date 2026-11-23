ALTER TABLE "webhook" DROP CONSTRAINT "webhook_scope_check";--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_oauth_client_id_oauth_client_client_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_oauth_client_id_unique" UNIQUE("oauth_client_id");--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_scope_check" CHECK (("webhook"."team_id" IS NOT NULL)::int + "webhook"."all_public_teams"::int + ("webhook"."oauth_client_id" IS NOT NULL)::int = 1);