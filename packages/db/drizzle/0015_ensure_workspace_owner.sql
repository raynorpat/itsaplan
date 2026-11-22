-- A workspace always has an owner. An instance without a god user before 0010 has
-- none after it, so the oldest account becomes the owner.
UPDATE "user" SET "workspace_role" = 'owner'
WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at", "id" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "workspace_role" = 'owner');
