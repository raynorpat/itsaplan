ALTER TABLE "team_notification_setting" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_telegram_account" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "team_notification_setting" CASCADE;--> statement-breakpoint
DROP TABLE "user_telegram_account" CASCADE;--> statement-breakpoint
ALTER TABLE "notification_delivery" DROP CONSTRAINT "notification_delivery_channel_check";--> statement-breakpoint
ALTER TABLE "user_notification_preference" DROP COLUMN "telegram_events";--> statement-breakpoint
DELETE FROM "notification_delivery" WHERE "channel" = 'telegram';--> statement-breakpoint
DELETE FROM "app_secret" WHERE "key" = 'telegram.bot';--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_channel_check" CHECK ("notification_delivery"."channel" IN ('email'));