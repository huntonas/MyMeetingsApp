ALTER TABLE "meetings" ADD COLUMN "location" geography(Point, 4326) GENERATED ALWAYS AS (
  CASE WHEN "latitude" IS NULL OR "longitude" IS NULL THEN NULL
  ELSE ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography END
) STORED;
--> statement-breakpoint
CREATE INDEX "meetings_location_idx" ON "meetings" USING gist ("location");
