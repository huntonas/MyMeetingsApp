CREATE TABLE "feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"state" text NOT NULL,
	"url" text NOT NULL,
	"priority" integer NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"meeting_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feeds_slug_unique" UNIQUE("slug"),
	CONSTRAINT "feeds_url_unique" UNIQUE("url"),
	CONSTRAINT "feeds_entity_type_check" CHECK ("feeds"."entity_type" in ('area', 'district', 'intergroup', 'central_office')),
	CONSTRAINT "feeds_state_check" CHECK ("feeds"."state" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "address_geocodes" (
	"address_key" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "address_geocodes_status_check" CHECK ("address_geocodes"."status" in ('matched', 'no_match'))
);
--> statement-breakpoint
CREATE TABLE "feed_meetings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feed_id" integer NOT NULL,
	"meeting_id" uuid NOT NULL,
	"source_slug" text NOT NULL,
	"day" smallint NOT NULL,
	"time" text NOT NULL,
	"end_time" text,
	"timezone" text,
	"name" text NOT NULL,
	"types" text[] NOT NULL,
	"attendance" text NOT NULL,
	"location_name" text,
	"formatted_address" text,
	"address_key" text,
	"latitude" double precision,
	"longitude" double precision,
	"location_notes" text,
	"notes" text,
	"group_name" text,
	"conference_url" text,
	"conference_url_notes" text,
	"conference_phone" text,
	"conference_phone_notes" text,
	"source_url" text,
	"seen_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "feed_meetings_feed_slug_day_unique" UNIQUE("feed_id","source_slug","day"),
	CONSTRAINT "feed_meetings_day_check" CHECK ("feed_meetings"."day" between 0 and 6),
	CONSTRAINT "feed_meetings_attendance_check" CHECK ("feed_meetings"."attendance" in ('in_person', 'hybrid', 'online'))
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_feed_meeting_id" bigint,
	"day" smallint NOT NULL,
	"time" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"timezone" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_meetings" ADD CONSTRAINT "feed_meetings_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_meetings" ADD CONSTRAINT "feed_meetings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_meetings_meeting_idx" ON "feed_meetings" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "feed_meetings_address_key_idx" ON "feed_meetings" USING btree ("address_key");--> statement-breakpoint
CREATE INDEX "feed_meetings_conference_url_idx" ON "feed_meetings" USING btree ("conference_url");--> statement-breakpoint
CREATE INDEX "meetings_day_time_idx" ON "meetings" USING btree ("day","time");