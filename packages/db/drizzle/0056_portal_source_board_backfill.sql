-- Portal suggestions made before issue.portal_source_board_id existed: an issue a
-- visitor created (external_user_creator_id) with that visitor's portal feedback on it
-- came from the board that takes its team's suggestions. When several boards take the
-- team's suggestions the board is unknown, and the issue is left without one.
UPDATE "issue" AS i
SET "portal_source_board_id" = b."id"
FROM "portal_board" AS b
WHERE i."portal_source_board_id" IS NULL
  AND i."external_user_creator_id" IS NOT NULL
  AND b."suggestion_team_id" = i."team_id"
  AND (SELECT count(*) FROM "portal_board" AS o WHERE o."suggestion_team_id" = i."team_id") = 1
  AND EXISTS (
    SELECT 1 FROM "attachment" AS a
    WHERE a."issue_id" = i."id"
      AND a."source_type" = 'feedback'
      AND a."external_user_creator_id" = i."external_user_creator_id"
      AND a."metadata"->>'source' = 'portal'
  );
