-- API keys of the deleted agent bot users. apikey.reference_id holds the owning
-- user's id without a foreign key, so deleting the users in 0007 left their keys.
DELETE FROM "apikey" WHERE "reference_id" NOT IN (SELECT "id"::text FROM "user");--> statement-breakpoint
-- Tables the removed Mastra runtime created at runtime, whatever version created
-- them. 0007 drops the known ones; this drops any left.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'mastra\_%' LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', t);
  END LOOP;
END $$;
