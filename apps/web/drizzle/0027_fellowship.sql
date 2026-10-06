ALTER TABLE "feeds" DROP CONSTRAINT "feeds_entity_type_check";--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "fellowship" text DEFAULT 'aa' NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "format" text DEFAULT 'meeting_guide' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "fellowship" text DEFAULT 'aa' NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_fellowship_check" CHECK ("feeds"."fellowship" in ('aa', 'na'));--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_format_check" CHECK ("feeds"."format" in ('meeting_guide', 'bmlt'));--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_entity_type_check" CHECK ("feeds"."entity_type" in ('area', 'district', 'intergroup', 'central_office', 'region'));--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_fellowship_check" CHECK ("meetings"."fellowship" in ('aa', 'na'));