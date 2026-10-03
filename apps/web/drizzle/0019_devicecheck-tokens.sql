CREATE TABLE "devicecheck_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"seen_on" date DEFAULT (now() at time zone 'utc')::date NOT NULL
);
