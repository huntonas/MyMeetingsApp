CREATE TABLE "rate_limits" (
	"device_hash" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" date NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_pkey" PRIMARY KEY("device_hash","bucket","window_start"),
	CONSTRAINT "rate_limits_bucket_check" CHECK ("rate_limits"."bucket" in ('tag_submission'))
);
