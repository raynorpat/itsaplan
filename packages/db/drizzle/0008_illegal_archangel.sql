ALTER TABLE "user_preference" DROP CONSTRAINT "user_preference_start_page_check";--> statement-breakpoint
-- The AI chat start page was removed with the built-in agents.
UPDATE "user_preference" SET "start_page" = 'work-items' WHERE "start_page" = 'ai-chat';--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_start_page_check" CHECK ("user_preference"."start_page" IN ('inbox', 'work-items', 'projects'));
