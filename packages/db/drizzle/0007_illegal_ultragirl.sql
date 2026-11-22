-- The built-in AI agents are removed. Their bot users go first, which cascades to
-- their team memberships, API keys and sessions; comments and history they wrote
-- keep the stored author name.
DELETE FROM "user" WHERE "id" IN (SELECT "user_id" FROM "ai_agent");--> statement-breakpoint
DROP TABLE "agent_run" CASCADE;--> statement-breakpoint
DROP TABLE "agent_schedule" CASCADE;--> statement-breakpoint
DROP TABLE "agent_skill" CASCADE;--> statement-breakpoint
DROP TABLE "agent_skill_link" CASCADE;--> statement-breakpoint
DROP TABLE "agent_tool" CASCADE;--> statement-breakpoint
DROP TABLE "agent_tool_link" CASCADE;--> statement-breakpoint
DROP TABLE "ai_agent" CASCADE;--> statement-breakpoint
DROP TABLE "integration_credential" CASCADE;--> statement-breakpoint
ALTER TABLE "user_preference" DROP COLUMN "show_chat_by_default";--> statement-breakpoint
-- Tables the Mastra agent runtime created outside Drizzle.
DROP TABLE IF EXISTS "mastra_agent_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_agents" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_ai_spans" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_background_tasks" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_channel_config" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_channel_installations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_dataset_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_dataset_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_datasets" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_evals" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_experiment_results" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_experiments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_favorites" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_mcp_client_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_mcp_clients" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_mcp_server_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_mcp_servers" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_messages" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_notifications" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_observational_memory" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_prompt_block_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_prompt_blocks" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_resources" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_schedule_triggers" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_schedules" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_scorer_definition_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_scorer_definitions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_scorers" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_skill_blobs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_skill_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_skills" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_threads" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_tool_provider_connections" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_traces" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_workflow_snapshot" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_workspace_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_workspaces" CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS "trigger_set_timestamps"() CASCADE;
