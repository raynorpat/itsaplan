ALTER TABLE "project" ADD COLUMN "history_start" date;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "issue_count_history" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "completed_issue_count_history" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "scope_history" real[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "completed_scope_history" real[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "in_progress_scope_history" real[] DEFAULT '{}' NOT NULL;