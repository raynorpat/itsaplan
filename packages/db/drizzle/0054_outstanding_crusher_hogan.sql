CREATE TABLE "form_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"template_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"answers" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_submission_email_lower_check" CHECK ("form_submission"."email" = lower("form_submission"."email"))
);
--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_token_hash_uq" ON "form_submission" USING btree ("token_hash");