ALTER TABLE "user" ADD COLUMN "workspace_role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_visibility_check" CHECK ("team"."visibility" IN ('public', 'private'));--> statement-breakpoint
-- Linear's roles: the instance's god user becomes the workspace owner, everyone else
-- a member; team owners keep owning their teams.
UPDATE "user" SET "workspace_role" = 'owner' WHERE "role" = 'god';--> statement-breakpoint
UPDATE "team_member" SET "owner" = true WHERE "role" = 'owner';
