CREATE TABLE "portal_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"external_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sign_in_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"board_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_external_user_id_external_user_id_fk" FOREIGN KEY ("external_user_id") REFERENCES "public"."external_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sign_in_token" ADD CONSTRAINT "portal_sign_in_token_board_id_portal_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."portal_board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_session_token_hash_uq" ON "portal_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_session_external_user_idx" ON "portal_session" USING btree ("external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sign_in_token_hash_uq" ON "portal_sign_in_token" USING btree ("token_hash");