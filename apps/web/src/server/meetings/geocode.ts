import { and, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { addressGeocodes, feedMeetings } from "@/db/schema";
import { readEnv } from "@/env";
import { USER_AGENT } from "@/server/feeds/fetch-feed";
import type { HostThrottle } from "@/server/feeds/throttle";
import { recomputeMeetings } from "@/server/meetings/recompute";

const DEFAULT_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const BATCH_SIZE = 100;
const TIMEOUT_MS = 15_000;

export function parseCensusResponse(json: unknown): { latitude: number; longitude: number } | null {
  if (typeof json !== "object" || json === null) return null;
  const matches: unknown = (json as { result?: { addressMatches?: unknown } }).result?.addressMatches;
  if (!Array.isArray(matches)) return null;
  const coordinates: unknown = (matches[0] as { coordinates?: unknown } | undefined)?.coordinates;
  if (typeof coordinates !== "object" || coordinates === null) return null;
  const { x, y } = coordinates as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" ? { latitude: y, longitude: x } : null;
}

async function geocode(
  address: string,
  throttle: HostThrottle,
): Promise<{ latitude: number; longitude: number } | null | "error"> {
  const url = new URL(readEnv("CENSUS_GEOCODER_URL") ?? DEFAULT_GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  await throttle.wait(url.host);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "error";
    return parseCensusResponse(await response.json());
  } catch {
    return "error";
  }
}

// Spec §3: geocode meetings missing coordinates after sync. Results are keyed by normalized address and kept.
export async function geocodePendingAddresses(throttle: HostThrottle, deadline: number): Promise<number> {
  if (Date.now() >= deadline) return 0;
  const pending = await db
    .selectDistinctOn([feedMeetings.addressKey], {
      addressKey: feedMeetings.addressKey,
      address: feedMeetings.formattedAddress,
    })
    .from(feedMeetings)
    .where(
      and(
        isNull(feedMeetings.archivedAt),
        isNull(feedMeetings.latitude),
        isNotNull(feedMeetings.addressKey),
        isNotNull(feedMeetings.formattedAddress),
        sql`not exists (select 1 from address_geocodes g where g.address_key = ${feedMeetings.addressKey})`,
      ),
    )
    .limit(BATCH_SIZE);

  const stored: string[] = [];
  for (const { addressKey, address } of pending) {
    if (Date.now() >= deadline) break;
    if (addressKey === null || address === null) continue;
    const result = await geocode(address, throttle);
    if (result === "error") continue;
    await db
      .insert(addressGeocodes)
      .values(
        result === null ? { addressKey, status: "no_match" } : { addressKey, status: "matched", ...result },
      );
    stored.push(addressKey);
  }

  if (stored.length > 0) {
    const affected = await db
      .selectDistinct({ id: feedMeetings.meetingId })
      .from(feedMeetings)
      .where(inArray(feedMeetings.addressKey, stored));
    await recomputeMeetings(affected.map((row) => row.id));
  }
  return stored.length;
}
