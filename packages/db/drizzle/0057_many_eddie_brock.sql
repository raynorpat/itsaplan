ALTER TABLE "external_user" ADD COLUMN "updates_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "updates_unsubscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "change_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "summary_cadence" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "changes_sent_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "last_change_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "summary_sent_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "last_visit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_user" ADD COLUMN "previous_visit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_user" ADD CONSTRAINT "external_user_summary_cadence_check" CHECK ("external_user"."summary_cadence" IN ('weekly', 'daily', 'off'));