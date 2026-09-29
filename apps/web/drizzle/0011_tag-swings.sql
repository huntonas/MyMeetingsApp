CREATE TABLE "tag_swings" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"tag_id" integer NOT NULL,
	"new_devices" integer NOT NULL,
	"prior_devices" integer NOT NULL,
	"flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tag_swings" ADD CONSTRAINT "tag_swings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_swings" ADD CONSTRAINT "tag_swings_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_swings_open_idx" ON "tag_swings" USING btree ("meeting_id","tag_id") WHERE "tag_swings"."reviewed_at" is null;