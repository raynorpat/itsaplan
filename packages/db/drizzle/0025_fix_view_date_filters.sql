-- Repairs saved views that 0021 converted before its date rules were fixed (0021 now
-- writes the repaired shapes on a fresh database, so this is a no-op there):
--   * a date comparison with no value ({"lt": null} / {"gt": null}, from a condition
--     without a date) is dropped, as the web converter drops it;
--   * "after D" on createdAt / updatedAt becomes gte the next day, so D itself is
--     excluded as for dueDate and in the web's filter bar.
CREATE FUNCTION pg_temp.fix_view_element(e jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  k text;
  cmp jsonb;
  op text;
BEGIN
  IF jsonb_typeof(e) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 1 THEN RETURN e; END IF;
  k := (SELECT key FROM jsonb_object_keys(e) AS key LIMIT 1);
  IF k NOT IN ('dueDate', 'createdAt', 'updatedAt') THEN RETURN e; END IF;
  cmp := e->k;
  IF jsonb_typeof(cmp) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(cmp)) <> 1 THEN RETURN e; END IF;
  op := (SELECT key FROM jsonb_object_keys(cmp) AS key LIMIT 1);
  IF op NOT IN ('lt', 'gt') THEN RETURN e; END IF;
  IF jsonb_typeof(cmp->op) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  IF op = 'gt' AND k IN ('createdAt', 'updatedAt') AND (cmp->>op) ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object(k, jsonb_build_object('gte', to_char((cmp->>op)::date + 1, 'YYYY-MM-DD')));
  END IF;
  RETURN e;
END $$;--> statement-breakpoint
UPDATE "team_view" v SET "filter_data" = (
  SELECT CASE WHEN count(*) = 0 THEN '{}'::jsonb ELSE jsonb_build_object('and', jsonb_agg(fixed ORDER BY ord)) END
  FROM (
    SELECT pg_temp.fix_view_element(x.e) AS fixed, x.ord
    FROM jsonb_array_elements(v."filter_data"->'and') WITH ORDINALITY AS x(e, ord)
  ) f WHERE fixed IS NOT NULL)
WHERE jsonb_typeof(v."filter_data"->'and') = 'array' AND (SELECT count(*) FROM jsonb_object_keys(v."filter_data")) = 1;
