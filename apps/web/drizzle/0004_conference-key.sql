SET LOCAL lock_timeout = '10s';--> statement-breakpoint
DROP INDEX "feed_meetings_conference_url_idx";--> statement-breakpoint
ALTER TABLE "feed_meetings" ADD COLUMN "conference_key" text GENERATED ALWAYS AS (coalesce(
    'zoom:' || (regexp_match(regexp_replace(lower("conference_url"), '%20|[[:space:]]', '', 'g'),
      '^https?://(?:[a-z0-9-]+[.])*zoom[.]us/(?:j|my|w|s)/([^/?#]+)'))[1],
    rtrim(regexp_replace(
      lower(substring(regexp_replace("conference_url", '^[[:space:]]+|[[:space:]]+$', '', 'g') from '^[^/?#]*//[^/?#]*')) || substring(regexp_replace("conference_url", '^[[:space:]]+|[[:space:]]+$', '', 'g') from '^[^/?#]*//[^/?#]*(.*)$'),
      '#.*$', ''), '/')
  )) STORED;--> statement-breakpoint
CREATE INDEX "feed_meetings_conference_key_idx" ON "feed_meetings" USING btree ("conference_key");