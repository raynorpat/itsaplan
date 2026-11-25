CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_id" text NOT NULL,
	"name" text NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"external_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"main_source_id" text,
	"owner_id" uuid,
	"status_id" uuid NOT NULL,
	"tier_id" uuid,
	"revenue" integer,
	"size" integer,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_name_check" CHECK (btrim("customer"."name") <> ''),
	CONSTRAINT "customer_revenue_check" CHECK ("customer"."revenue" IS NULL OR "customer"."revenue" >= 0),
	CONSTRAINT "customer_size_check" CHECK ("customer"."size" IS NULL OR "customer"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"color" text NOT NULL,
	"description" text,
	"position" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_status_name_check" CHECK (btrim("customer_status"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "customer_tier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"color" text NOT NULL,
	"description" text,
	"position" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_tier_name_check" CHECK (btrim("customer_tier"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "portal_board" DROP CONSTRAINT "portal_board_scope_check";--> statement-breakpoint
ALTER TABLE "portal_board" DROP CONSTRAINT "portal_board_access_check";--> statement-breakpoint
ALTER TABLE "customer_need" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "customer_source" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "customers_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "customers_revenue_currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "customers_seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_board" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "portal_board" ADD COLUMN "shows" text DEFAULT 'issues' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_status_id_customer_status_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."customer_status"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_tier_id_customer_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."customer_tier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_slug_id_uq" ON "customer" USING btree ("slug_id");--> statement-breakpoint
CREATE INDEX "customer_domains_idx" ON "customer" USING gin ("domains");--> statement-breakpoint
ALTER TABLE "customer_need" ADD CONSTRAINT "customer_need_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_user" ADD CONSTRAINT "external_user_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_need_customer_idx" ON "customer_need" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "external_user_customer_idx" ON "external_user" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "external_user" ADD CONSTRAINT "external_user_customer_source_check" CHECK ("external_user"."customer_source" IS NULL OR "external_user"."customer_source" IN ('domain', 'manual'));--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_shows_check" CHECK ("portal_board"."shows" = 'issues' OR ("portal_board"."shows" = 'customerRequests' AND "portal_board"."access" = 'customer'));--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_scope_check" CHECK (("portal_board"."shows" = 'customerRequests' AND "portal_board"."team_id" IS NULL AND "portal_board"."project_id" IS NULL) OR ("portal_board"."shows" = 'issues' AND ("portal_board"."team_id" IS NULL) <> ("portal_board"."project_id" IS NULL)));--> statement-breakpoint
ALTER TABLE "portal_board" ADD CONSTRAINT "portal_board_access_check" CHECK ("portal_board"."access" IN ('public', 'restricted', 'customer'));