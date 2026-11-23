ALTER TABLE "label" ADD COLUMN "retired_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_retired_by_user_id_user_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Labels retired before the retirer was recorded: their creator, the closest record.
UPDATE "label" SET "retired_by_user_id" = "creator_user_id" WHERE "retired_at" IS NOT NULL AND "retired_by_user_id" IS NULL;
--> statement-breakpoint
-- Saved views store their display as Linear's view preferences. Rewrite displays saved
-- in the web's own shape (layout 'kanban', sort, group, properties) to Linear's keys.
UPDATE "view_preferences" SET "preferences" = jsonb_strip_nulls(jsonb_build_object(
  'layout', CASE "preferences"->>'layout' WHEN 'kanban' THEN 'board' WHEN 'table' THEN 'list' ELSE "preferences"->>'layout' END,
  'viewOrdering', CASE "preferences"#>>'{sort,field}' WHEN 'status' THEN 'workflowState' WHEN 'created' THEN 'createdAt' WHEN 'updated' THEN 'updatedAt' ELSE "preferences"#>>'{sort,field}' END,
  'viewOrderingDirection', "preferences"#>>'{sort,dir}',
  'issueGrouping', CASE "preferences"->>'group' WHEN 'none' THEN 'noGrouping' WHEN 'status' THEN 'workflowState' ELSE "preferences"->>'group' END,
  'issueSubGrouping', CASE "preferences"->>'subgroup' WHEN 'none' THEN 'noGrouping' WHEN 'status' THEN 'workflowState' ELSE "preferences"->>'subgroup' END,
  'showEmptyGroups', "preferences"->'showEmptyGroups',
  'hiddenColumns', "preferences"->'hiddenGroups',
  'columnOrderList', "preferences"->'properties',
  'timelineZoomScale', CASE "preferences"->>'timelineScale' WHEN 'week' THEN 1 WHEN 'month' THEN 2 WHEN 'quarter' THEN 3 END,
  'fieldId', "preferences"->'properties' ? 'id',
  'fieldStatus', "preferences"->'properties' ? 'status',
  'fieldPriority', "preferences"->'properties' ? 'priority',
  'fieldAssignee', "preferences"->'properties' ? 'assignee',
  'fieldProject', "preferences"->'properties' ? 'project',
  'fieldLabels', "preferences"->'properties' ? 'labels',
  'fieldDueDate', "preferences"->'properties' ? 'dueDate',
  'fieldDateCreated', "preferences"->'properties' ? 'created',
  'fieldDateUpdated', "preferences"->'properties' ? 'updated'
)) WHERE "preferences" ?| array['sort', 'group', 'properties', 'timelineScale'];
