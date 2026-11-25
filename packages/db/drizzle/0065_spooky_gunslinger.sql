ALTER TABLE "team" ADD COLUMN "issue_estimation_type" text DEFAULT 'notUsed' NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "issue_estimation_extended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "issue_estimation_allow_zero" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "default_issue_estimate" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_issue_estimation_type_check" CHECK ("team"."issue_estimation_type" IN ('notUsed', 'exponential', 'fibonacci', 'linear', 'tShirt'));--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_default_issue_estimate_check" CHECK ("team"."default_issue_estimate" >= 0);