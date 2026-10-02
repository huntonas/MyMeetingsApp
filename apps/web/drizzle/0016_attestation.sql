CREATE TABLE "attest_challenges" (
	"challenge" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "attest_key_id" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "attest_public_key" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "attest_counter" bigint;--> statement-breakpoint
CREATE INDEX "attest_challenges_expires_idx" ON "attest_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_attest_key_idx" ON "devices" USING btree ("attest_key_id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_attest_check" CHECK (("devices"."attest_key_id" is null) = ("devices"."attest_public_key" is null) and ("devices"."attest_key_id" is null) = ("devices"."attest_counter" is null));