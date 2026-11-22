CREATE TABLE "file_upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"filename" text NOT NULL,
	"size" integer NOT NULL,
	"object_key" text NOT NULL,
	"meta_data" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_upload_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_upload_user_idx" ON "file_upload" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_upload_created_idx" ON "file_upload" USING btree ("created_at");