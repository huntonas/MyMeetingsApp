CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"sort_order" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tags_category_check" CHECK ("tags"."category" in ('format', 'sharing', 'crowd', 'feel', 'practical')),
	CONSTRAINT "tags_status_check" CHECK ("tags"."status" in ('active', 'retired'))
);
