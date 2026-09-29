CREATE TABLE "ai_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"suggestion_id" integer NOT NULL,
	"input" text NOT NULL,
	"decision" text NOT NULL,
	"tag_slug" text,
	"reason" text NOT NULL,
	"model" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_decisions_decision_check" CHECK ("ai_decisions"."decision" in ('merge', 'reject', 'pending'))
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"merged_tag_id" integer,
	"device_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "suggestions_status_check" CHECK ("suggestions"."status" in ('pending', 'merged', 'rejected')),
	CONSTRAINT "suggestions_text_check" CHECK (char_length("suggestions"."text") between 2 and 40),
	CONSTRAINT "suggestions_merged_tag_check" CHECK (("suggestions"."status" = 'merged') = ("suggestions"."merged_tag_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "rate_limits" DROP CONSTRAINT "rate_limits_bucket_check";--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_merged_tag_id_tags_id_fk" FOREIGN KEY ("merged_tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestions_device_idx" ON "suggestions" USING btree ("device_hash");--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_bucket_check" CHECK ("rate_limits"."bucket" in ('tag_submission', 'suggestion'));