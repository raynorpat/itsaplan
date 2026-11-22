ALTER TABLE "issue" DROP CONSTRAINT "issue_type_id_issue_type_id_fk";
--> statement-breakpoint
ALTER TABLE "issue" DROP COLUMN "type_id";--> statement-breakpoint
DROP TABLE "issue_field_option" CASCADE;--> statement-breakpoint
DROP TABLE "issue_field_value" CASCADE;--> statement-breakpoint
DROP TABLE "custom_field_option" CASCADE;--> statement-breakpoint
DROP TABLE "custom_field" CASCADE;--> statement-breakpoint
DROP TABLE "issue_type" CASCADE;--> statement-breakpoint
DROP TABLE "team_action" CASCADE;--> statement-breakpoint
-- History entries of removed issue types and custom fields.
DELETE FROM "issue_activity" WHERE "action" IN ('type', 'field');
