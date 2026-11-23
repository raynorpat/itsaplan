ALTER TABLE "notification" DROP CONSTRAINT "notification_type_check";--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "agent_session_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "agent_activity_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_agent_session_id_agent_session_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_agent_activity_id_agent_activity_id_fk" FOREIGN KEY ("agent_activity_id") REFERENCES "public"."agent_activity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_type_check" CHECK ("notification"."type" IN ('assigned', 'mentioned', 'commented', 'state_changed', 'agent_needs_input', 'agent_responded'));