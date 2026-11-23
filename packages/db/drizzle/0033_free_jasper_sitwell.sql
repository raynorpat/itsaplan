CREATE TABLE "agent_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"content" jsonb NOT NULL,
	"signal" text,
	"signal_metadata" jsonb,
	"ephemeral" boolean DEFAULT false NOT NULL,
	"source_comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_activity_type_check" CHECK ("agent_activity"."type" IN ('thought', 'action', 'elicitation', 'response', 'error', 'prompt')),
	CONSTRAINT "agent_activity_signal_check" CHECK ("agent_activity"."signal" IS NULL OR "agent_activity"."signal" IN ('auth', 'continue', 'select', 'stop'))
);
--> statement-breakpoint
CREATE TABLE "agent_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug_id" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"comment_id" uuid,
	"source_comment_id" uuid,
	"app_user_id" uuid NOT NULL,
	"creator_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text,
	"plan" jsonb,
	"external_link" text,
	"external_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dismissed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_session_slug_id_unique" UNIQUE("slug_id"),
	CONSTRAINT "agent_session_status_check" CHECK ("agent_session"."status" IN ('pending', 'active', 'stopping', 'awaitingInput', 'complete', 'error', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_source_comment_id_comment_id_fk" FOREIGN KEY ("source_comment_id") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_source_comment_id_comment_id_fk" FOREIGN KEY ("source_comment_id") REFERENCES "public"."comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_app_user_id_user_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_dismissed_by_user_id_user_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_activity_session_idx" ON "agent_activity" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_session_issue_idx" ON "agent_session" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "agent_session_app_user_idx" ON "agent_session" USING btree ("app_user_id");--> statement-breakpoint
CREATE INDEX "agent_session_comment_idx" ON "agent_session" USING btree ("comment_id");