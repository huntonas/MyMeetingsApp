ALTER TABLE "suggestions" DROP CONSTRAINT "suggestions_status_check";--> statement-breakpoint
ALTER TABLE "suggestions" DROP CONSTRAINT "suggestions_merged_tag_check";--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_status_check" CHECK ("suggestions"."status" in ('pending', 'approved', 'merged', 'rejected'));--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_merged_tag_check" CHECK (("suggestions"."status" in ('approved', 'merged')) = ("suggestions"."merged_tag_id" is not null));