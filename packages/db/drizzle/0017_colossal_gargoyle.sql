CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"name" text DEFAULT 'Workspace' NOT NULL,
	"url_key" text DEFAULT 'workspace' NOT NULL,
	"logo_url" text,
	"allowed_auth_services" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_file_upload_content_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"team_creation_role" text DEFAULT 'member' NOT NULL,
	"label_management_role" text DEFAULT 'member' NOT NULL,
	"invitations_role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "organization_singleton_check" CHECK ("organization"."singleton"),
	CONSTRAINT "organization_roles_check" CHECK ("organization"."team_creation_role" IN ('owner', 'admin', 'member') AND "organization"."label_management_role" IN ('owner', 'admin', 'member') AND "organization"."invitations_role" IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
-- The workspace row. It keeps the id and creation time GraphQL clients already saw
-- (stored under app_setting 'graphql_organization'), and the allowed upload types from
-- the god-mode storage settings (or the default list when none were stored).
INSERT INTO "organization" ("id", "created_at", "updated_at", "allowed_file_upload_content_types")
SELECT
  COALESCE((SELECT ("value"->>'id')::uuid FROM "app_setting" WHERE "key" = 'graphql_organization'), gen_random_uuid()),
  COALESCE((SELECT ("value"->>'createdAt')::timestamptz FROM "app_setting" WHERE "key" = 'graphql_organization'), now()),
  now(),
  COALESCE(
    (SELECT ARRAY(SELECT jsonb_array_elements_text("value"->'attachmentMimeTypes')) FROM "app_setting" WHERE "key" = 'storage'),
    ARRAY['image/*','video/*','application/pdf','text/plain','text/csv','text/markdown','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.oasis.opendocument.text','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.oasis.opendocument.spreadsheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.oasis.opendocument.presentation']
  );--> statement-breakpoint
-- Settings that moved to the organization row or to environment variables.
DELETE FROM "app_setting" WHERE "key" IN ('graphql_organization', 'storage');--> statement-breakpoint
DELETE FROM "app_secret" WHERE "key" = 'auth.google';
