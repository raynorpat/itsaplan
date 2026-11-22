-- Best-effort ids for issue change-log rows written before from_id / to_id were
-- recorded (0020). Each stored name is matched within the issue's team at migration
-- time, and an id is written only when exactly one row matches, so a renamed or
-- deleted item, or an ambiguous name, stays unmatched (the feed then shows the
-- change without a name).

-- Workflow states of the issue's team, by name.
UPDATE "issue_activity" a SET "from_id" = (
  SELECT (array_agg(ws."id"))[1] FROM "workflow_state" ws JOIN "issue" i ON i."team_id" = ws."team_id"
  WHERE i."id" = a."issue_id" AND ws."name" = a."from_text" HAVING count(*) = 1)
WHERE a."action" = 'status' AND a."from_id" IS NULL AND a."from_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint
UPDATE "issue_activity" a SET "to_id" = (
  SELECT (array_agg(ws."id"))[1] FROM "workflow_state" ws JOIN "issue" i ON i."team_id" = ws."team_id"
  WHERE i."id" = a."issue_id" AND ws."name" = a."to_text" HAVING count(*) = 1)
WHERE a."action" = 'status' AND a."to_id" IS NULL AND a."to_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint

-- Assignees and delegates: members of the issue's team, by name.
UPDATE "issue_activity" a SET "from_id" = (
  SELECT (array_agg(u."id"))[1] FROM "user" u
  JOIN "team_member" m ON m."user_id" = u."id" JOIN "issue" i ON i."team_id" = m."team_id"
  WHERE i."id" = a."issue_id" AND u."name" = a."from_text" HAVING count(*) = 1)
WHERE a."action" IN ('assignee', 'delegate') AND a."from_id" IS NULL AND a."from_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint
UPDATE "issue_activity" a SET "to_id" = (
  SELECT (array_agg(u."id"))[1] FROM "user" u
  JOIN "team_member" m ON m."user_id" = u."id" JOIN "issue" i ON i."team_id" = m."team_id"
  WHERE i."id" = a."issue_id" AND u."name" = a."to_text" HAVING count(*) = 1)
WHERE a."action" IN ('assignee', 'delegate') AND a."to_id" IS NULL AND a."to_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint

-- Labels of the issue's team or the workspace, by name.
UPDATE "issue_activity" a SET "to_id" = (
  SELECT (array_agg(l."id"))[1] FROM "label" l JOIN "issue" i ON l."team_id" = i."team_id" OR l."team_id" IS NULL
  WHERE i."id" = a."issue_id" AND l."name" = a."to_text" HAVING count(*) = 1)
WHERE a."action" = 'label_add' AND a."to_id" IS NULL AND a."to_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint
UPDATE "issue_activity" a SET "from_id" = (
  SELECT (array_agg(l."id"))[1] FROM "label" l JOIN "issue" i ON l."team_id" = i."team_id" OR l."team_id" IS NULL
  WHERE i."id" = a."issue_id" AND l."name" = a."from_text" HAVING count(*) = 1)
WHERE a."action" = 'label_remove' AND a."from_id" IS NULL AND a."from_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint

-- Projects that include the issue's team, by name.
UPDATE "issue_activity" a SET "from_id" = (
  SELECT (array_agg(p."id"))[1] FROM "project" p
  JOIN "project_team" pt ON pt."project_id" = p."id" JOIN "issue" i ON i."team_id" = pt."team_id"
  WHERE i."id" = a."issue_id" AND p."name" = a."from_text" HAVING count(*) = 1)
WHERE a."action" = 'project' AND a."from_id" IS NULL AND a."from_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint
UPDATE "issue_activity" a SET "to_id" = (
  SELECT (array_agg(p."id"))[1] FROM "project" p
  JOIN "project_team" pt ON pt."project_id" = p."id" JOIN "issue" i ON i."team_id" = pt."team_id"
  WHERE i."id" = a."issue_id" AND p."name" = a."to_text" HAVING count(*) = 1)
WHERE a."action" = 'project' AND a."to_id" IS NULL AND a."to_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint

-- Cycles of the issue's team, by name or "Cycle <number>".
UPDATE "issue_activity" a SET "from_id" = (
  SELECT (array_agg(c."id"))[1] FROM "cycle" c JOIN "issue" i ON i."team_id" = c."team_id"
  WHERE i."id" = a."issue_id" AND coalesce(c."name", 'Cycle ' || c."number") = a."from_text" HAVING count(*) = 1)
WHERE a."action" = 'cycle' AND a."from_id" IS NULL AND a."from_text" IS NOT NULL AND a."issue_id" IS NOT NULL;--> statement-breakpoint
UPDATE "issue_activity" a SET "to_id" = (
  SELECT (array_agg(c."id"))[1] FROM "cycle" c JOIN "issue" i ON i."team_id" = c."team_id"
  WHERE i."id" = a."issue_id" AND coalesce(c."name", 'Cycle ' || c."number") = a."to_text" HAVING count(*) = 1)
WHERE a."action" = 'cycle' AND a."to_id" IS NULL AND a."to_text" IS NOT NULL AND a."issue_id" IS NOT NULL;
