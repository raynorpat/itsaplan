ALTER TABLE "integration" DROP CONSTRAINT "integration_creator_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "integration" ALTER COLUMN "creator_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_import_team_in_process_uq" ON "issue_import" USING btree ("team_id") WHERE "issue_import"."status" = 'inProcess';