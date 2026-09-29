CREATE TABLE "devices" (
	"device_hash" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"first_seen_date" date DEFAULT (now() at time zone 'utc')::date NOT NULL,
	"last_seen_date" date DEFAULT (now() at time zone 'utc')::date NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "devices_platform_check" CHECK ("devices"."platform" in ('ios', 'android')),
	CONSTRAINT "devices_hash_check" CHECK ("devices"."device_hash" ~ '^[0-9a-f]{64}$')
);
