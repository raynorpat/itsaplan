CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 1000,
	"rate_limit_max" integer DEFAULT 100,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text DEFAULT 'user',
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"issue_id" uuid,
	"schedule_id" uuid,
	"trigger" text DEFAULT 'delegation' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"source_comment_id" uuid,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"output" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_status_check" CHECK ("agent_run"."status" IN ('pending', 'success', 'failed')),
	CONSTRAINT "agent_run_trigger_check" CHECK ("agent_run"."trigger" IN ('mention', 'delegation', 'schedule', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "agent_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_schedule_agent_id_name_unique" UNIQUE("agent_id","name"),
	CONSTRAINT "agent_schedule_status_check" CHECK ("agent_schedule"."status" IN ('active', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "agent_skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"s3_prefix" text NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_skill_team_id_name_unique" UNIQUE("team_id","name"),
	CONSTRAINT "agent_skill_source_check" CHECK ("agent_skill"."source" IN ('upload', 'inline', 'github'))
);
--> statement-breakpoint
CREATE TABLE "agent_skill_link" (
	"agent_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "agent_skill_link_agent_id_skill_id_pk" PRIMARY KEY("agent_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "agent_tool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"tool_key" text NOT NULL,
	"credential_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tool_team_id_tool_key_credential_id_unique" UNIQUE("team_id","tool_key","credential_id")
);
--> statement-breakpoint
CREATE TABLE "agent_tool_link" (
	"agent_id" uuid NOT NULL,
	"agent_tool_id" uuid NOT NULL,
	CONSTRAINT "agent_tool_link_agent_id_agent_tool_id_pk" PRIMARY KEY("agent_id","agent_tool_id")
);
--> statement-breakpoint
CREATE TABLE "ai_agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"username" text NOT NULL,
	"kind" text NOT NULL,
	"model_credential_id" uuid,
	"model" text,
	"instructions" text,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"temperature" double precision,
	"max_steps" integer,
	"trigger_on_mention" boolean DEFAULT true NOT NULL,
	"trigger_on_assign" boolean DEFAULT false NOT NULL,
	"role_id" uuid,
	"api_key_ciphertext" text,
	"api_key_iv" text,
	"api_key_auth_tag" text,
	"memory_enabled" boolean DEFAULT false NOT NULL,
	"memory_last_messages" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_team_id_username_unique" UNIQUE("team_id","username"),
	CONSTRAINT "ai_agent_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "ai_agent_kind_check" CHECK ("ai_agent"."kind" IN ('external', 'internal'))
);
--> statement-breakpoint
CREATE TABLE "app_secret" (
	"key" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"redacted" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid,
	"project_id" uuid,
	"project_update_id" uuid,
	"initiative_update_id" uuid,
	"parent_id" uuid,
	"user_id" uuid,
	"user_name" text,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolving_user_id" uuid,
	"resolving_comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_parent_check" CHECK (num_nonnulls("comment"."issue_id", "comment"."project_id", "comment"."project_update_id", "comment"."initiative_update_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "custom_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"issue_type_id" uuid,
	"name" text NOT NULL,
	"field_type" text NOT NULL,
	"show_in_body" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_field_type_check" CHECK ("custom_field"."field_type" IN ('text', 'markdown', 'url', 'number', 'boolean', 'date', 'select', 'multi_select'))
);
--> statement-breakpoint
CREATE TABLE "custom_field_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"value" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custom_field_option_field_id_value_unique" UNIQUE("field_id","value")
);
--> statement-breakpoint
CREATE TABLE "cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"issue_count_history" integer[] DEFAULT '{}' NOT NULL,
	"completed_issue_count_history" integer[] DEFAULT '{}' NOT NULL,
	"scope_history" real[] DEFAULT '{}' NOT NULL,
	"completed_scope_history" real[] DEFAULT '{}' NOT NULL,
	"in_progress_scope_history" real[] DEFAULT '{}' NOT NULL,
	"uncompleted_issue_ids_upon_close" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_team_id_number_unique" UNIQUE("team_id","number"),
	CONSTRAINT "cycle_dates_check" CHECK ("cycle"."ends_at" > "cycle"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "initiative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"content" text,
	"color" text,
	"icon" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"owner_user_id" uuid,
	"creator_user_id" uuid,
	"lead_team_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"priority_sort_order" double precision DEFAULT 0 NOT NULL,
	"target_date" date,
	"target_date_resolution" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"slug_id" text DEFAULT substr(md5(gen_random_uuid()::text), 1, 12) NOT NULL,
	"archived_at" timestamp with time zone,
	"trashed" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_slug_id_unique" UNIQUE("slug_id"),
	CONSTRAINT "initiative_status_check" CHECK ("initiative"."status" IN ('Proposed', 'Planned', 'Active', 'Completed', 'Canceled')),
	CONSTRAINT "initiative_priority_check" CHECK ("initiative"."priority" BETWEEN 0 AND 4),
	CONSTRAINT "initiative_target_date_resolution_check" CHECK ("initiative"."target_date_resolution" IN ('month', 'quarter', 'halfYear', 'year'))
);
--> statement-breakpoint
CREATE TABLE "initiative_relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiative_id" uuid NOT NULL,
	"related_initiative_id" uuid NOT NULL,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_relation_related_initiative_id_unique" UNIQUE("related_initiative_id"),
	CONSTRAINT "initiative_relation_not_self" CHECK ("initiative_relation"."initiative_id" <> "initiative_relation"."related_initiative_id")
);
--> statement-breakpoint
CREATE TABLE "initiative_to_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiative_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_to_project_unique" UNIQUE("initiative_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "initiative_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiative_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"health" text NOT NULL,
	"edited_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_update_health_check" CHECK ("initiative_update"."health" IN ('onTrack', 'atRisk', 'offTrack'))
);
--> statement-breakpoint
CREATE TABLE "integration_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"integration_key" text NOT NULL,
	"label" text,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"redacted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"type_id" uuid,
	"project_id" uuid,
	"project_milestone_id" uuid,
	"cycle_id" uuid,
	"state_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"delegate_user_id" uuid,
	"parent_id" uuid,
	"creator_user_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"estimate" real,
	"start_date" date,
	"due_date" date,
	"position" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"share_token" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_share_token_unique" UNIQUE("share_token"),
	CONSTRAINT "issue_team_id_sequence_number_unique" UNIQUE("team_id","sequence_number"),
	CONSTRAINT "issue_priority_check" CHECK ("issue"."priority" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE "issue_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid,
	"project_id" uuid,
	"actor_user_id" uuid,
	"actor_name" text,
	"action" text,
	"subject" text,
	"from_text" text,
	"to_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_activity_owner_check" CHECK (("issue_activity"."issue_id" IS NOT NULL) <> ("issue_activity"."project_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "issue_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_attachment_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "issue_field_option" (
	"issue_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	CONSTRAINT "issue_field_option_issue_id_field_id_option_id_pk" PRIMARY KEY("issue_id","field_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "issue_field_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value_text" text,
	"value_number" numeric,
	"value_bool" boolean,
	"value_date" date,
	CONSTRAINT "issue_field_value_issue_id_field_id_unique" UNIQUE("issue_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "issue_label" (
	"issue_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "issue_label_issue_id_label_id_pk" PRIMARY KEY("issue_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "issue_relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"related_issue_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_relation_type_check" CHECK ("issue_relation"."type" IN ('blocks', 'duplicate', 'related')),
	CONSTRAINT "issue_relation_not_self" CHECK ("issue_relation"."issue_id" <> "issue_relation"."related_issue_id")
);
--> statement-breakpoint
CREATE TABLE "issue_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_type_team_id_name_unique" UNIQUE("team_id","name")
);
--> statement-breakpoint
CREATE TABLE "label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"parent_id" uuid,
	"is_group" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"retired_at" timestamp with time zone,
	"creator_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_team_id_name_unique" UNIQUE NULLS NOT DISTINCT("team_id","name")
);
--> statement-breakpoint
CREATE TABLE "note_board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"canvas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"source_activity_id" uuid,
	"source_comment_id" uuid,
	"type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"read_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_type_check" CHECK ("notification"."type" IN ('assigned', 'mentioned', 'commented', 'state_changed'))
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_channel_check" CHECK ("notification_delivery"."channel" IN ('email', 'telegram'))
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"color" text,
	"icon" text,
	"status_id" uuid NOT NULL,
	"lead_user_id" uuid,
	"creator_user_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"target_date" date,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"slug_id" text DEFAULT substr(md5(gen_random_uuid()::text), 1, 12) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_slug_id_unique" UNIQUE("slug_id"),
	CONSTRAINT "project_priority_check" CHECK ("project"."priority" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE "project_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#4EA7FC' NOT NULL,
	"description" text,
	"parent_id" uuid,
	"is_group" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_label_sibling_name_unique" UNIQUE NULLS NOT DISTINCT("parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "project_label_link" (
	"project_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "project_label_link_project_id_label_id_pk" PRIMARY KEY("project_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "project_milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"target_date" date,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"color" text NOT NULL,
	"description" text,
	"position" double precision DEFAULT 0 NOT NULL,
	"indefinite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_status_type_check" CHECK ("project_status"."type" IN ('backlog', 'planned', 'started', 'paused', 'completed', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "project_team" (
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "project_team_project_id_team_id_pk" PRIMARY KEY("project_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "project_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"health" text NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_update_health_check" CHECK ("project_update"."health" IN ('onTrack', 'atRisk', 'offTrack'))
);
--> statement-breakpoint
CREATE TABLE "reaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid,
	"issue_id" uuid,
	"project_update_id" uuid,
	"initiative_update_id" uuid,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_parent_check" CHECK (num_nonnulls("reaction"."comment_id", "reaction"."issue_id", "reaction"."project_update_id", "reaction"."initiative_update_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"mcp_enabled" boolean DEFAULT false NOT NULL,
	"projects_enabled" boolean DEFAULT true NOT NULL,
	"dashboards_enabled" boolean DEFAULT true NOT NULL,
	"notes_enabled" boolean DEFAULT true NOT NULL,
	"cycles_enabled" boolean DEFAULT false NOT NULL,
	"cycle_duration" integer DEFAULT 2 NOT NULL,
	"cycle_start_day" integer DEFAULT 1 NOT NULL,
	"cycle_cooldown_time" integer DEFAULT 0 NOT NULL,
	"upcoming_cycle_count" integer DEFAULT 2 NOT NULL,
	"cycle_issue_auto_assign_started" boolean DEFAULT false NOT NULL,
	"cycle_issue_auto_assign_completed" boolean DEFAULT false NOT NULL,
	"next_cycle_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "team_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '' NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effect" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_dashboard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"role_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" uuid,
	"accepted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "team_invite_token_unique" UNIQUE("token"),
	CONSTRAINT "team_invite_role_check" CHECK ("team_invite"."role" IN ('owner', 'member')),
	CONSTRAINT "team_invite_status_check" CHECK ("team_invite"."status" IN ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"role_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_team_id_user_id_pk" PRIMARY KEY("team_id","user_id"),
	CONSTRAINT "team_member_role_check" CHECK ("team_member"."role" IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "team_notification_setting" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"redacted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_role_team_id_name_unique" UNIQUE("team_id","name")
);
--> statement-breakpoint
CREATE TABLE "team_setting" (
	"team_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_setting_team_id_key_pk" PRIMARY KEY("team_id","key")
);
--> statement-breakpoint
CREATE TABLE "team_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"share_token" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_view_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "user_notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"email_events" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"telegram_events" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_pref_user_team_unique" UNIQUE("user_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "user_preference" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"issue_open_mode" text DEFAULT 'panel' NOT NULL,
	"start_page" text DEFAULT 'work-items' NOT NULL,
	"show_chat_by_default" boolean DEFAULT false NOT NULL,
	"issue_stats_open" boolean DEFAULT true NOT NULL,
	"issue_stats_view" text DEFAULT 'compact' NOT NULL,
	"hotkeys" jsonb,
	"last_team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preference_theme_check" CHECK ("user_preference"."theme" IN ('light', 'dark', 'system')),
	CONSTRAINT "user_preference_issue_open_mode_check" CHECK ("user_preference"."issue_open_mode" IN ('panel', 'page')),
	CONSTRAINT "user_preference_start_page_check" CHECK ("user_preference"."start_page" IN ('inbox', 'dashboard', 'work-items', 'projects', 'ai-chat')),
	CONSTRAINT "user_preference_issue_stats_view_check" CHECK ("user_preference"."issue_stats_view" IN ('compact', 'timeline'))
);
--> statement-breakpoint
CREATE TABLE "user_telegram_account" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" text,
	"username" text,
	"first_name" text,
	"link_code" text,
	"link_code_expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"all_public_teams" boolean DEFAULT false NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"secret" text NOT NULL,
	"resource_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"creator_user_id" uuid,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_scope_check" CHECK (("webhook"."team_id" IS NOT NULL) <> "webhook"."all_public_teams")
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"response_status" integer,
	"response_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"state_type" text DEFAULT 'unstarted' NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_state_state_type_check" CHECK ("workflow_state"."state_type" IN ('backlog', 'unstarted', 'started', 'completed', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_schedule_id_agent_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."agent_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_source_comment_id_comment_id_fk" FOREIGN KEY ("source_comment_id") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD CONSTRAINT "agent_schedule_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_link" ADD CONSTRAINT "agent_skill_link_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_link" ADD CONSTRAINT "agent_skill_link_skill_id_agent_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."agent_skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool" ADD CONSTRAINT "agent_tool_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool" ADD CONSTRAINT "agent_tool_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_link" ADD CONSTRAINT "agent_tool_link_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_link" ADD CONSTRAINT "agent_tool_link_agent_tool_id_agent_tool_id_fk" FOREIGN KEY ("agent_tool_id") REFERENCES "public"."agent_tool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_model_credential_id_integration_credential_id_fk" FOREIGN KEY ("model_credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_role_id_team_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."team_role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_project_update_id_project_update_id_fk" FOREIGN KEY ("project_update_id") REFERENCES "public"."project_update"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_initiative_update_id_initiative_update_id_fk" FOREIGN KEY ("initiative_update_id") REFERENCES "public"."initiative_update"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_id_comment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_resolving_user_id_user_id_fk" FOREIGN KEY ("resolving_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_resolving_comment_id_comment_id_fk" FOREIGN KEY ("resolving_comment_id") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_issue_type_id_issue_type_id_fk" FOREIGN KEY ("issue_type_id") REFERENCES "public"."issue_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_option" ADD CONSTRAINT "custom_field_option_field_id_custom_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_lead_team_id_team_id_fk" FOREIGN KEY ("lead_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_relation" ADD CONSTRAINT "initiative_relation_initiative_id_initiative_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_relation" ADD CONSTRAINT "initiative_relation_related_initiative_id_initiative_id_fk" FOREIGN KEY ("related_initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_relation" ADD CONSTRAINT "initiative_relation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_to_project" ADD CONSTRAINT "initiative_to_project_initiative_id_initiative_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_to_project" ADD CONSTRAINT "initiative_to_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_update" ADD CONSTRAINT "initiative_update_initiative_id_initiative_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_update" ADD CONSTRAINT "initiative_update_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_type_id_issue_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."issue_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_project_milestone_id_project_milestone_id_fk" FOREIGN KEY ("project_milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_state_id_workflow_state_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."workflow_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_delegate_user_id_user_id_fk" FOREIGN KEY ("delegate_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_parent_id_issue_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_option" ADD CONSTRAINT "issue_field_option_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_option" ADD CONSTRAINT "issue_field_option_field_id_custom_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_option" ADD CONSTRAINT "issue_field_option_option_id_custom_field_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."custom_field_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_value" ADD CONSTRAINT "issue_field_value_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_field_value" ADD CONSTRAINT "issue_field_value_field_id_custom_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_label" ADD CONSTRAINT "issue_label_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_label" ADD CONSTRAINT "issue_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relation" ADD CONSTRAINT "issue_relation_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relation" ADD CONSTRAINT "issue_relation_related_issue_id_issue_id_fk" FOREIGN KEY ("related_issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_type" ADD CONSTRAINT "issue_type_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_parent_id_label_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."label"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_board" ADD CONSTRAINT "note_board_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_board" ADD CONSTRAINT "note_board_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_source_activity_id_issue_activity_id_fk" FOREIGN KEY ("source_activity_id") REFERENCES "public"."issue_activity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_source_comment_id_comment_id_fk" FOREIGN KEY ("source_comment_id") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_status_id_project_status_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."project_status"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_lead_user_id_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_label" ADD CONSTRAINT "project_label_parent_id_project_label_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."project_label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_label_link" ADD CONSTRAINT "project_label_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_label_link" ADD CONSTRAINT "project_label_link_label_id_project_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."project_label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_update" ADD CONSTRAINT "project_update_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_update" ADD CONSTRAINT "project_update_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_project_update_id_project_update_id_fk" FOREIGN KEY ("project_update_id") REFERENCES "public"."project_update"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_initiative_update_id_initiative_update_id_fk" FOREIGN KEY ("initiative_update_id") REFERENCES "public"."initiative_update"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_action" ADD CONSTRAINT "team_action_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_dashboard" ADD CONSTRAINT "team_dashboard_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invite" ADD CONSTRAINT "team_invite_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invite" ADD CONSTRAINT "team_invite_role_id_team_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."team_role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invite" ADD CONSTRAINT "team_invite_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invite" ADD CONSTRAINT "team_invite_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_role_id_team_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."team_role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_notification_setting" ADD CONSTRAINT "team_notification_setting_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_role" ADD CONSTRAINT "team_role_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_setting" ADD CONSTRAINT "team_setting_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_view" ADD CONSTRAINT "team_view_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD CONSTRAINT "user_notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD CONSTRAINT "user_notification_preference_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_last_team_id_team_id_fk" FOREIGN KEY ("last_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_telegram_account" ADD CONSTRAINT "user_telegram_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_state" ADD CONSTRAINT "workflow_state_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_schedule_fire_uq" ON "agent_run" USING btree ("schedule_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "agent_run_due_idx" ON "agent_run" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "agent_run_schedule_idx" ON "agent_run" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "agent_run_source_comment_idx" ON "agent_run" USING btree ("source_comment_id");--> statement-breakpoint
CREATE INDEX "agent_schedule_due_idx" ON "agent_schedule" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "agent_schedule_agent_idx" ON "agent_schedule" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_skill_team_idx" ON "agent_skill" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "agent_skill_link_skill_idx" ON "agent_skill_link" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "agent_tool_team_idx" ON "agent_tool" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "agent_tool_credential_idx" ON "agent_tool" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "agent_tool_link_tool_idx" ON "agent_tool_link" USING btree ("agent_tool_id");--> statement-breakpoint
CREATE INDEX "ai_agent_team_idx" ON "ai_agent" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "comment_issue_idx" ON "comment" USING btree ("issue_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comment_project_idx" ON "comment" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comment_project_update_idx" ON "comment" USING btree ("project_update_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comment_initiative_update_idx" ON "comment" USING btree ("initiative_update_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comment_parent_idx" ON "comment" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comment_resolving_comment_idx" ON "comment" USING btree ("resolving_comment_id");--> statement-breakpoint
CREATE INDEX "cycle_team_starts_idx" ON "cycle" USING btree ("team_id","starts_at");--> statement-breakpoint
CREATE INDEX "initiative_lead_team_idx" ON "initiative" USING btree ("lead_team_id");--> statement-breakpoint
CREATE INDEX "initiative_relation_parent_idx" ON "initiative_relation" USING btree ("initiative_id");--> statement-breakpoint
CREATE INDEX "initiative_to_project_project_idx" ON "initiative_to_project" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "initiative_update_initiative_idx" ON "initiative_update" USING btree ("initiative_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "integration_credential_team_idx" ON "integration_credential" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "issue_team_active_idx" ON "issue" USING btree ("team_id","state_id") WHERE "issue"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "issue_cycle_idx" ON "issue" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "issue_activity_issue_idx" ON "issue_activity" USING btree ("issue_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "issue_activity_project_idx" ON "issue_activity" USING btree ("project_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "issue_attachment_issue_idx" ON "issue_attachment" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_relation_pair_idx" ON "issue_relation" USING btree (least("issue_id", "related_issue_id"),greatest("issue_id", "related_issue_id"));--> statement-breakpoint
CREATE INDEX "issue_relation_related_idx" ON "issue_relation" USING btree ("related_issue_id");--> statement-breakpoint
CREATE INDEX "note_board_team_idx" ON "note_board" USING btree ("team_id","updated_at");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_source_comment_idx" ON "notification" USING btree ("source_comment_id");--> statement-breakpoint
CREATE INDEX "notification_user_unread_idx" ON "notification" USING btree ("user_id","id" DESC NULLS LAST) WHERE "notification"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notification_delivery_due_idx" ON "notification_delivery" USING btree ("next_attempt_at") WHERE "notification_delivery"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "project_milestone_project_idx" ON "project_milestone" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "project_team_team_idx" ON "project_team" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "project_update_project_idx" ON "project_update" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_once_per_emoji_idx" ON "reaction" USING btree (coalesce("comment_id", "issue_id", "project_update_id", "initiative_update_id"),"user_id","emoji");--> statement-breakpoint
CREATE INDEX "reaction_comment_idx" ON "reaction" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "reaction_issue_idx" ON "reaction" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "reaction_project_update_idx" ON "reaction" USING btree ("project_update_id");--> statement-breakpoint
CREATE INDEX "reaction_initiative_update_idx" ON "reaction" USING btree ("initiative_update_id");--> statement-breakpoint
CREATE INDEX "team_action_team_idx" ON "team_action" USING btree ("team_id","position");--> statement-breakpoint
CREATE INDEX "team_dashboard_team_idx" ON "team_dashboard" USING btree ("team_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invite_pending_uq" ON "team_invite" USING btree ("team_id","email") WHERE "team_invite"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_invite_team_idx" ON "team_invite" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_member_user_idx" ON "team_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_role_default_uq" ON "team_role" USING btree ("team_id") WHERE "team_role"."is_default";--> statement-breakpoint
CREATE INDEX "team_role_team_idx" ON "team_role" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_view_team_idx" ON "team_view" USING btree ("team_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "user_telegram_account_chat_id_unique" ON "user_telegram_account" USING btree ("chat_id") WHERE "user_telegram_account"."chat_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_telegram_account_link_code_unique" ON "user_telegram_account" USING btree ("link_code") WHERE "user_telegram_account"."link_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "webhook_team_idx" ON "webhook" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_delivery" USING btree ("next_attempt_at") WHERE "webhook_delivery"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_idx" ON "webhook_delivery" USING btree ("webhook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_state_active_position_idx" ON "workflow_state" USING btree ("team_id","position") WHERE "workflow_state"."archived_at" IS NULL;--> statement-breakpoint
CREATE VIEW "public"."feed_entry" AS (
  SELECT id, issue_id, project_id, NULL::uuid AS project_update_id,
    NULL::uuid AS initiative_update_id, 'activity' AS kind,
    actor_user_id, actor_name, NULL::text AS body, action, subject, from_text, to_text,
    NULL::uuid AS parent_id, NULL::timestamptz AS edited_at, created_at
  FROM issue_activity
  UNION ALL
  SELECT id, issue_id, project_id, project_update_id, initiative_update_id, 'comment' AS kind,
    user_id, user_name, body, NULL, NULL, NULL, NULL, parent_id, edited_at, created_at
  FROM comment
);-- Seed the instance upload limits so every installation has a row to edit in god
-- mode, from the first migration. Keep these values in sync with
-- defaultStorageSettings() in apps/api/src/settings/storage.ts, which still applies
-- them in memory if the row is missing.
INSERT INTO "app_setting" ("key", "value")
VALUES (
	'storage',
	'{"maxAttachmentMb":25,"maxAvatarMb":5,"teamQuotaMb":51200,"attachmentMimeTypes":["image/*","video/*","application/pdf","text/plain","text/csv","text/markdown","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.oasis.opendocument.text","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.oasis.opendocument.spreadsheet","application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation","application/vnd.oasis.opendocument.presentation"]}'::jsonb
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- The six project statuses, one per Linear status type. Keep in sync with
-- packages/db/src/project-statuses.ts.
INSERT INTO "project_status" ("id", "name", "type", "color", "position")
VALUES
	('9b5c5b6e-1f1a-4c39-9b1a-000000000001', 'Backlog', 'backlog', '#bec2c8', 0),
	('9b5c5b6e-1f1a-4c39-9b1a-000000000002', 'Planned', 'planned', '#e2e2e2', 1),
	('9b5c5b6e-1f1a-4c39-9b1a-000000000003', 'In Progress', 'started', '#f2c94c', 2),
	('9b5c5b6e-1f1a-4c39-9b1a-000000000004', 'Paused', 'paused', '#0f7488', 3),
	('9b5c5b6e-1f1a-4c39-9b1a-000000000005', 'Completed', 'completed', '#5e6ad2', 4),
	('9b5c5b6e-1f1a-4c39-9b1a-000000000006', 'Canceled', 'canceled', '#95a2b3', 5);
