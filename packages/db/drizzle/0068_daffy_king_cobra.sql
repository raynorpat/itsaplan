CREATE TABLE "audit_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"ip" text,
	"country_code" text,
	"metadata" jsonb,
	"request_information" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "audit_retention" text DEFAULT '30d' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entry_created_idx" ON "audit_entry" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entry_type_created_idx" ON "audit_entry" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "audit_entry_actor_created_idx" ON "audit_entry" USING btree ("actor_id","created_at");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_audit_retention_check" CHECK ("organization"."audit_retention" IN ('30d', '90d', '1y', '2y', '3y', 'forever'));