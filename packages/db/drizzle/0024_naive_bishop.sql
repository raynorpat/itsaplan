ALTER TABLE "team" ADD COLUMN "auto_archive_period" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "notification_categories" jsonb;--> statement-breakpoint
-- Auto-archive: Linear's period in months replaces the two day thresholds. The larger
-- threshold is rounded up to the next allowed month value (1, 3, 6, 9, 12); a team
-- with neither threshold, or no stored setting, keeps archiving off (0).
UPDATE "team" t SET "auto_archive_period" = COALESCE((
  SELECT CASE
    WHEN d.days IS NULL THEN 0
    WHEN ceil(d.days / 30.0) <= 1 THEN 1
    WHEN ceil(d.days / 30.0) <= 3 THEN 3
    WHEN ceil(d.days / 30.0) <= 6 THEN 6
    WHEN ceil(d.days / 30.0) <= 9 THEN 9
    ELSE 12
  END
  FROM (
    SELECT GREATEST(
      CASE WHEN (s.value->>'completedDays') ~ '^[0-9]+$' THEN (s.value->>'completedDays')::int END,
      CASE WHEN (s.value->>'canceledDays') ~ '^[0-9]+$' THEN (s.value->>'canceledDays')::int END
    ) AS days
    FROM "team_setting" s
    WHERE s.team_id = t.id AND s.key = 'auto_archive'
  ) d
), 0);--> statement-breakpoint
DELETE FROM "team_setting" WHERE "key" = 'auto_archive';--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_auto_archive_period_check" CHECK ("team"."auto_archive_period" IN (0, 1, 3, 6, 9, 12));--> statement-breakpoint
-- Notification preferences: Linear's categories for the whole workspace replace the
-- per-team email toggles. A category is on when it was on in any team.
INSERT INTO "user_preference" ("user_id", "notification_categories")
SELECT p.user_id, jsonb_build_object(
  'assignments', COALESCE(bool_or((p.email_events->>'assigned')::boolean), false),
  'mentions', COALESCE(bool_or((p.email_events->>'mentioned')::boolean), false),
  'commentsAndReplies', COALESCE(bool_or((p.email_events->>'commented')::boolean), false),
  'statusChanges', COALESCE(bool_or((p.email_events->>'state_changed')::boolean), false)
)
FROM "user_notification_preference" p
GROUP BY p.user_id
ON CONFLICT ("user_id") DO UPDATE SET "notification_categories" = EXCLUDED."notification_categories";--> statement-breakpoint
DROP TABLE "user_notification_preference" CASCADE;
