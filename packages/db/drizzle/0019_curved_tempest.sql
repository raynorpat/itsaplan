ALTER TABLE "user_preference" DROP CONSTRAINT "user_preference_theme_check";--> statement-breakpoint
ALTER TABLE "user_preference" DROP CONSTRAINT "user_preference_issue_open_mode_check";--> statement-breakpoint
ALTER TABLE "user_preference" DROP CONSTRAINT "user_preference_start_page_check";--> statement-breakpoint
ALTER TABLE "user_preference" DROP CONSTRAINT "user_preference_issue_stats_view_check";--> statement-breakpoint
ALTER TABLE "user_preference" DROP CONSTRAINT "user_preference_last_team_id_team_id_fk";
--> statement-breakpoint
DROP INDEX "team_view_team_idx";--> statement-breakpoint
CREATE INDEX "team_view_team_idx" ON "team_view" USING btree ("team_id","created_at");--> statement-breakpoint
ALTER TABLE "issue" DROP COLUMN "start_date";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "mcp_enabled";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "projects_enabled";--> statement-breakpoint
ALTER TABLE "team_member" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "team_view" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "user_preference" DROP COLUMN "theme";--> statement-breakpoint
ALTER TABLE "user_preference" DROP COLUMN "issue_open_mode";--> statement-breakpoint
ALTER TABLE "user_preference" DROP COLUMN "start_page";--> statement-breakpoint
ALTER TABLE "user_preference" DROP COLUMN "issue_stats_open";--> statement-breakpoint
ALTER TABLE "user_preference" DROP COLUMN "issue_stats_view";--> statement-breakpoint
ALTER TABLE "user_preference" DROP COLUMN "hotkeys";--> statement-breakpoint
ALTER TABLE "user_preference" DROP COLUMN "last_team_id";