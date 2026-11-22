-- Pending team invites move to Linear's model: an address that already has an
-- account joins the team directly; the others become workspace invites (role
-- member) for every team they were invited to.
INSERT INTO "team_member" ("team_id", "user_id")
SELECT i."team_id", u."id"
FROM "team_invite" i
JOIN "user" u ON lower(u."email") = i."email"
WHERE i."status" = 'pending'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "workspace_invite" ("email", "role", "team_ids", "invited_by_user_id")
SELECT i."email", 'member', array_agg(DISTINCT i."team_id"), (array_agg(i."invited_by_user_id"))[1]
FROM "team_invite" i
WHERE i."status" = 'pending'
  AND NOT EXISTS (SELECT 1 FROM "user" u WHERE lower(u."email") = i."email")
GROUP BY i."email"
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE "team_invite" CASCADE;
