ALTER TABLE "comment" ADD COLUMN "portal_thread" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "comment" SET "portal_thread" = true WHERE "portal_board_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_session" ADD COLUMN "email" text;--> statement-breakpoint
UPDATE "portal_session" SET "email" = e."email" FROM "external_user" e WHERE e."id" = "portal_session"."external_user_id";--> statement-breakpoint
DELETE FROM "portal_session" WHERE "email" IS NULL;--> statement-breakpoint
ALTER TABLE "portal_session" ALTER COLUMN "email" SET NOT NULL;
