CREATE TABLE "customer_need" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"attachment_id" uuid,
	"body" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"creator_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_need_priority_check" CHECK ("customer_need"."priority" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "external_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"avatar_url" text,
	"created_by_id" uuid,
	"merged_into_id" uuid,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_user_email_lower_check" CHECK ("external_user"."email" = lower("external_user"."email")),
	CONSTRAINT "external_user_name_check" CHECK (btrim("external_user"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "external_user_creator_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_need" ADD CONSTRAINT "customer_need_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_need" ADD CONSTRAINT "customer_need_attachment_id_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_need" ADD CONSTRAINT "customer_need_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_user" ADD CONSTRAINT "external_user_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_user" ADD CONSTRAINT "external_user_merged_into_id_external_user_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."external_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_need_issue_idx" ON "customer_need" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_need_attachment_uq" ON "customer_need" USING btree ("attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_user_email_uq" ON "external_user" USING btree ("email") WHERE "external_user"."email" IS NOT NULL AND "external_user"."merged_into_id" IS NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_external_user_creator_id_external_user_id_fk" FOREIGN KEY ("external_user_creator_id") REFERENCES "public"."external_user"("id") ON DELETE set null ON UPDATE no action;