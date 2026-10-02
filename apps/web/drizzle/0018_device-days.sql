CREATE TABLE "device_days" (
	"device_hash" text NOT NULL,
	"day" date NOT NULL,
	"platform" text NOT NULL,
	"attest_key_id" text,
	"attest_counter" bigint,
	CONSTRAINT "device_days_pkey" PRIMARY KEY("device_hash","day"),
	CONSTRAINT "device_days_platform_check" CHECK ("device_days"."platform" in ('ios', 'android')),
	CONSTRAINT "device_days_attest_check" CHECK (("device_days"."attest_key_id" is null) = ("device_days"."attest_counter" is null))
);
