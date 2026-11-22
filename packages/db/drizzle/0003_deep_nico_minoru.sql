CREATE TABLE "issue_subscription" (
	"issue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_subscription_issue_id_user_id_pk" PRIMARY KEY("issue_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_subscription" ADD CONSTRAINT "issue_subscription_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_subscription" ADD CONSTRAINT "issue_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_subscription_user_idx" ON "issue_subscription" USING btree ("user_id");--> statement-breakpoint
-- Backfill: subscribe the members who are notified today (actors in each issue's
-- feed, which includes the creator's `created` entry) and each issue's assignee.
INSERT INTO "issue_subscription" ("issue_id", "user_id")
SELECT DISTINCT s.issue_id, s.user_id
FROM (
  SELECT f.issue_id, f.actor_user_id AS user_id FROM "feed_entry" f
  WHERE f.issue_id IS NOT NULL AND f.actor_user_id IS NOT NULL
  UNION
  SELECT i.id, i.assignee_user_id FROM "issue" i WHERE i.assignee_user_id IS NOT NULL
) s
JOIN "issue" i ON i.id = s.issue_id
JOIN "team_member" m ON m.team_id = i.team_id AND m.user_id = s.user_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "notification" SET "updated_at" = "created_at";
