DROP INDEX "feed_meetings_conference_url_idx";--> statement-breakpoint
ALTER TABLE "feed_meetings" ADD COLUMN "conference_key" text GENERATED ALWAYS AS (case
    when regexp_replace(lower("conference_url"), '%20|[[:space:]]', '', 'g') ~ '^https?://(?:[a-z0-9-]+[.])*zoom[.]us(?:[/?#]|$)' then 'zoom:' || (regexp_match(regexp_replace(lower("conference_url"), '%20|[[:space:]]', '', 'g'),
      '^https?://(?:[a-z0-9-]+[.])*zoom[.]us/(?:j|my|w|s)/([^/?#]+)'))[1]
    when regexp_replace(substring(regexp_replace("conference_url", '^[[:space:]]+|[[:space:]]+$', '', 'g') from '^[^/?#]*//[^/?#]*(.*)$'), '#.*$', '') ~ '^/*$' then null
    else rtrim(lower(substring(regexp_replace("conference_url", '^[[:space:]]+|[[:space:]]+$', '', 'g') from '^[^/?#]*//[^/?#]*')) || regexp_replace(substring(regexp_replace("conference_url", '^[[:space:]]+|[[:space:]]+$', '', 'g') from '^[^/?#]*//[^/?#]*(.*)$'), '#.*$', ''), '/')
  end) STORED;--> statement-breakpoint
CREATE INDEX "feed_meetings_conference_key_idx" ON "feed_meetings" USING btree ("conference_key");