ALTER TABLE "feeds" ADD COLUMN "waiting_reason" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "contacted_on" date;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "outreach_note" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "access_key" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_waiting_reason_check" CHECK ("feeds"."waiting_reason" in ('restricted', 'bot_check'));