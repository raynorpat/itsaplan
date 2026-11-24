CREATE TABLE "user_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"verified_at" timestamp with time zone,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_email" ADD CONSTRAINT "user_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_user_email_uq" ON "user_email" USING btree ("user_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_verified_uq" ON "user_email" USING btree ("email") WHERE "user_email"."verified_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_token_uq" ON "user_email" USING btree ("token_hash");