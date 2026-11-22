ALTER TABLE "note_board" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_dashboard" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "note_board" CASCADE;--> statement-breakpoint
DROP TABLE "team_dashboard" CASCADE;--> statement-breakpoint
ALTER TABLE "issue" DROP CONSTRAINT "issue_share_token_unique";--> statement-breakpoint
ALTER TABLE "team_view" DROP CONSTRAINT "team_view_share_token_unique";--> statement-breakpoint
ALTER TABLE "user_preference" DROP CONSTRAINT "user_preference_start_page_check";--> statement-breakpoint
ALTER TABLE "issue" DROP COLUMN "share_token";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "dashboards_enabled";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "notes_enabled";--> statement-breakpoint
ALTER TABLE "team_view" DROP COLUMN "share_token";--> statement-breakpoint
UPDATE "user_preference" SET "start_page" = 'work-items' WHERE "start_page" = 'dashboard';--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_start_page_check" CHECK ("user_preference"."start_page" IN ('inbox', 'work-items', 'projects', 'ai-chat'));