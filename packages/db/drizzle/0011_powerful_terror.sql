ALTER TABLE "team_invite" DROP CONSTRAINT "team_invite_role_id_team_role_id_fk";--> statement-breakpoint
ALTER TABLE "team_member" DROP CONSTRAINT "team_member_role_id_team_role_id_fk";--> statement-breakpoint
ALTER TABLE "team_member" DROP CONSTRAINT "team_member_role_check";--> statement-breakpoint
DROP TABLE "team_role" CASCADE;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "team_invite" DROP COLUMN "role_id";--> statement-breakpoint
ALTER TABLE "team_member" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "team_member" DROP COLUMN "role_id";
