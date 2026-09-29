CREATE TABLE "meeting_aliases" (
	"old_meeting_id" uuid PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_hash" text NOT NULL,
	"meeting_id" uuid NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_audit_action_check" CHECK ("tag_audit"."action" in ('submit', 'edit'))
);
--> statement-breakpoint
CREATE TABLE "tag_counts" (
	"meeting_id" uuid NOT NULL,
	"tag_id" integer NOT NULL,
	"device_count" integer NOT NULL,
	"verified_count" integer NOT NULL,
	CONSTRAINT "tag_counts_pkey" PRIMARY KEY("meeting_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag_submissions" (
	"meeting_id" uuid NOT NULL,
	"submitter_id" text NOT NULL,
	"scope_meeting_id" uuid NOT NULL,
	"tag_ids" integer[] NOT NULL,
	"near_meeting" boolean NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tag_submissions_pkey" PRIMARY KEY("meeting_id","submitter_id"),
	CONSTRAINT "tag_submissions_submitter_check" CHECK ("tag_submissions"."submitter_id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tag_submissions_tag_ids_check" CHECK (cardinality("tag_submissions"."tag_ids") between 1 and 6)
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "tags_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_aliases" ADD CONSTRAINT "meeting_aliases_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_audit" ADD CONSTRAINT "tag_audit_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_counts" ADD CONSTRAINT "tag_counts_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_counts" ADD CONSTRAINT "tag_counts_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_submissions" ADD CONSTRAINT "tag_submissions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_aliases_meeting_idx" ON "meeting_aliases" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "tag_audit_meeting_idx" ON "tag_audit" USING btree ("meeting_id","at");--> statement-breakpoint
CREATE INDEX "tag_audit_device_idx" ON "tag_audit" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "tag_submissions_submitter_idx" ON "tag_submissions" USING btree ("submitter_id");