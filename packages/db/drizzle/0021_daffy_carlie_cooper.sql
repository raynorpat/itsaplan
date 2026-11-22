CREATE TABLE "view_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"view_type" text NOT NULL,
	"custom_view_id" uuid NOT NULL,
	"user_id" uuid,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_preferences_type_check" CHECK ("view_preferences"."type" IN ('organization', 'user')),
	CONSTRAINT "view_preferences_user_check" CHECK (("view_preferences"."type" = 'user') = ("view_preferences"."user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "filter_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "shared" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "slug_id" text DEFAULT substr(md5(random()::text), 1, 12) NOT NULL;--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "creator_user_id" uuid;--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "team_view" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_custom_view_id_team_view_id_fk" FOREIGN KEY ("custom_view_id") REFERENCES "public"."team_view"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "view_preferences_org_uq" ON "view_preferences" USING btree ("custom_view_id") WHERE "view_preferences"."type" = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX "view_preferences_user_uq" ON "view_preferences" USING btree ("custom_view_id","user_id") WHERE "view_preferences"."type" = 'user';--> statement-breakpoint
ALTER TABLE "team_view" ADD CONSTRAINT "team_view_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_view" ADD CONSTRAINT "team_view_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_view" ADD CONSTRAINT "team_view_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_view" ADD CONSTRAINT "team_view_slug_id_unique" UNIQUE("slug_id");--> statement-breakpoint
-- Convert each saved view's web filter set ({ conditions: [{ field, op, values }] })
-- into Linear's IssueFilter. The same rules are in apps/web/src/utils/viewFilters.ts.
CREATE FUNCTION pg_temp.view_condition(c jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  f text := c->>'field';
  op text := c->>'op';
  vals jsonb := COALESCE(c->'values', '[]'::jsonb);
  ids jsonb := COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(vals) v WHERE v <> 'null'::jsonb AND v <> '""'::jsonb), '[]'::jsonb);
  has_null boolean := EXISTS (SELECT 1 FROM jsonb_array_elements(vals) v WHERE v = 'null'::jsonb);
  has_ids boolean;
  k text;
  df text;
BEGIN
  has_ids := jsonb_array_length(ids) > 0;
  IF f IN ('status', 'statusType') THEN
    k := CASE f WHEN 'status' THEN 'id' ELSE 'type' END;
    IF op = 'is' AND has_ids THEN RETURN jsonb_build_object('state', jsonb_build_object(k, jsonb_build_object('in', ids))); END IF;
    IF op = 'is_not' AND has_ids THEN RETURN jsonb_build_object('state', jsonb_build_object(k, jsonb_build_object('nin', ids))); END IF;
    RETURN NULL;
  END IF;
  IF f IN ('assignee', 'delegate') THEN
    IF op = 'is_set' THEN RETURN jsonb_build_object(f, '{"null": false}'::jsonb); END IF;
    IF op = 'is_not_set' THEN RETURN jsonb_build_object(f, '{"null": true}'::jsonb); END IF;
    IF op = 'is' THEN
      IF has_ids AND has_null THEN
        RETURN jsonb_build_object('or', jsonb_build_array(
          jsonb_build_object(f, jsonb_build_object('id', jsonb_build_object('in', ids))),
          jsonb_build_object(f, '{"null": true}'::jsonb)));
      ELSIF has_ids THEN RETURN jsonb_build_object(f, jsonb_build_object('id', jsonb_build_object('in', ids)));
      ELSIF has_null THEN RETURN jsonb_build_object(f, '{"null": true}'::jsonb);
      END IF;
      RETURN NULL;
    END IF;
    IF op = 'is_not' THEN
      IF has_ids AND has_null THEN RETURN jsonb_build_object(f, jsonb_build_object('id', jsonb_build_object('nin', ids)));
      ELSIF has_ids THEN
        RETURN jsonb_build_object('or', jsonb_build_array(
          jsonb_build_object(f, '{"null": true}'::jsonb),
          jsonb_build_object(f, jsonb_build_object('id', jsonb_build_object('nin', ids)))));
      ELSIF has_null THEN RETURN jsonb_build_object(f, '{"null": false}'::jsonb);
      END IF;
      RETURN NULL;
    END IF;
    RETURN NULL;
  END IF;
  IF f = 'priority' THEN
    IF op = 'is_set' THEN RETURN '{"priority": {"neq": 0}}'::jsonb; END IF;
    IF op = 'is_not_set' THEN RETURN '{"priority": {"eq": 0}}'::jsonb; END IF;
    IF jsonb_array_length(vals) = 0 THEN RETURN NULL; END IF;
    ids := (SELECT jsonb_agg(CASE WHEN v = 'null'::jsonb THEN to_jsonb(0) ELSE v END) FROM jsonb_array_elements(vals) v);
    IF op = 'is' THEN RETURN jsonb_build_object('priority', jsonb_build_object('in', ids)); END IF;
    IF op = 'is_not' THEN RETURN jsonb_build_object('priority', jsonb_build_object('nin', ids)); END IF;
    RETURN NULL;
  END IF;
  IF f = 'labels' THEN
    IF op = 'is_set' THEN RETURN '{"labels": {"length": {"gt": 0}}}'::jsonb; END IF;
    IF op = 'is_not_set' THEN RETURN '{"labels": {"length": {"eq": 0}}}'::jsonb; END IF;
    IF op = 'is' THEN
      IF has_ids AND has_null THEN
        RETURN jsonb_build_object('or', jsonb_build_array(
          jsonb_build_object('labels', jsonb_build_object('some', jsonb_build_object('id', jsonb_build_object('in', ids)))),
          '{"labels": {"length": {"eq": 0}}}'::jsonb));
      ELSIF has_ids THEN RETURN jsonb_build_object('labels', jsonb_build_object('some', jsonb_build_object('id', jsonb_build_object('in', ids))));
      ELSIF has_null THEN RETURN '{"labels": {"length": {"eq": 0}}}'::jsonb;
      END IF;
      RETURN NULL;
    END IF;
    IF op = 'is_not' THEN
      IF has_ids AND has_null THEN
        RETURN jsonb_build_object('and', jsonb_build_array(
          jsonb_build_object('labels', jsonb_build_object('every', jsonb_build_object('id', jsonb_build_object('nin', ids)))),
          '{"labels": {"length": {"gt": 0}}}'::jsonb));
      ELSIF has_ids THEN RETURN jsonb_build_object('labels', jsonb_build_object('every', jsonb_build_object('id', jsonb_build_object('nin', ids))));
      ELSIF has_null THEN RETURN '{"labels": {"length": {"gt": 0}}}'::jsonb;
      END IF;
      RETURN NULL;
    END IF;
    RETURN NULL;
  END IF;
  IF f IN ('dueDate', 'created', 'updated') THEN
    df := CASE f WHEN 'dueDate' THEN 'dueDate' WHEN 'created' THEN 'createdAt' ELSE 'updatedAt' END;
    IF op = 'is_set' THEN RETURN jsonb_build_object(df, '{"null": false}'::jsonb); END IF;
    IF op = 'is_not_set' THEN RETURN jsonb_build_object(df, '{"null": true}'::jsonb); END IF;
    IF jsonb_typeof(vals->0) <> 'string' THEN RETURN NULL; END IF;
    IF op = 'before' THEN RETURN jsonb_build_object(df, jsonb_build_object('lt', vals->0)); END IF;
    IF op = 'after' THEN RETURN jsonb_build_object(df, jsonb_build_object('gt', vals->0)); END IF;
    RETURN NULL;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
UPDATE "team_view" v SET "filter_data" = COALESCE(
  (SELECT CASE WHEN count(*) = 0 THEN '{}'::jsonb ELSE jsonb_build_object('and', jsonb_agg(e ORDER BY ord)) END
   FROM (
     SELECT pg_temp.view_condition(c) AS e, ord
     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v."filters"->'conditions') = 'array' THEN v."filters"->'conditions' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(c, ord)
   ) conv WHERE e IS NOT NULL),
  '{}'::jsonb);--> statement-breakpoint
-- The view's display moves to its organization view preferences.
INSERT INTO "view_preferences" ("type", "view_type", "custom_view_id", "preferences")
SELECT 'organization', 'customView', v."id", v."display" FROM "team_view" v
WHERE v."display" <> '{}'::jsonb;--> statement-breakpoint
-- Creator: the team's oldest owner, else its oldest member.
UPDATE "team_view" v SET "creator_user_id" = (
  SELECT m."user_id" FROM "team_member" m WHERE m."team_id" = v."team_id"
  ORDER BY m."owner" DESC, m."created_at" ASC LIMIT 1);--> statement-breakpoint
UPDATE "team_view" SET "owner_user_id" = "creator_user_id", "updated_by_user_id" = "creator_user_id", "updated_at" = "created_at";
