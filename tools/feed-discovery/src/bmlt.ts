import { type RegistryEntry, sameBmltRoot } from "@mymeetingapp/feed-kit";
import { z } from "zod";

import type { Crawler } from "./crawler";
import { entityId } from "./ids";
import { US_STATES } from "./states";

// The aggregator's own list of NA root servers (github.com/bmlt-enabled/aggregator).
export const SERVER_LIST_URL =
  "https://raw.githubusercontent.com/bmlt-enabled/aggregator/main/serverList.json";
const FIELDS = [
  "id_bigint",
  "meeting_name",
  "weekday_tinyint",
  "start_time",
  "duration_time",
  "time_zone",
  "venue_type",
  "formats",
  "location_text",
  "location_info",
  "location_street",
  "location_municipality",
  "location_province",
  "location_postal_code_1",
  "latitude",
  "longitude",
  "virtual_meeting_link",
  "phone_meeting_number",
  "comments",
  "root_server_uri",
].join(",");
// A server is a U.S. one when most of its meetings are in U.S. states.
const US_SHARE = 0.5;

export const ServerList = z.array(z.object({ name: z.string().min(1), url: z.url() }));
const BmltAnswer = z.object({
  meetings: z.array(
    z.object({
      location_province: z.string().optional(),
      location_municipality: z.string().optional(),
      root_server_uri: z.string().optional(),
    }),
  ),
});

const CODE_BY_NAME = new Map(US_STATES.map((state) => [state.name.toLowerCase(), state.code]));
const CODES = new Set(US_STATES.map((state) => state.code));

// "TN", "Tennessee" and "tennessee" are Tennessee; anything else isn't a U.S. state.
function stateCode(province: string | undefined): string | null {
  const value = province?.trim() ?? "";
  if (CODES.has(value.toUpperCase())) return value.toUpperCase();
  return CODE_BY_NAME.get(value.toLowerCase()) ?? null;
}

// The feed the sync reads: every meeting the server holds, with its formats' world_ids (NA design, §1).
function feedUrl(root: string): string {
  const base = root.endsWith("/") ? root : `${root}/`;
  return `${base}client_interface/json/?switcher=GetSearchResults&get_used_formats=1&data_field_key=${FIELDS}`;
}

function parsed(body: string): z.infer<typeof BmltAnswer> | null {
  try {
    const answer = BmltAnswer.safeParse(JSON.parse(body));
    return answer.success ? answer.data : null;
  } catch {
    return null;
  }
}

// One registry entry for a U.S. root server, or null for a server elsewhere, or one that didn't answer.
export async function bmltEntry(
  server: { name: string; url: string },
  crawler: Crawler,
  checkedAt: string,
): Promise<RegistryEntry | null> {
  const url = feedUrl(server.url);
  const result = await crawler.get(url);
  if (result.kind !== "response" || result.status !== 200) return null;
  const answer = parsed(result.body);
  // Only the rows the sync would apply: the server's own (normalizeBmlt counts them by the same rule).
  const meetings = answer?.meetings.filter(
    (meeting) => meeting.root_server_uri === undefined || sameBmltRoot(meeting.root_server_uri, server.url),
  );
  if (meetings === undefined || meetings.length === 0) return null;

  const counts = new Map<string, number>();
  const cities = new Set<string>();
  for (const meeting of meetings) {
    const code = stateCode(meeting.location_province);
    if (code === null) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
    const city = meeting.location_municipality?.trim() ?? "";
    if (city !== "") cities.add(`${city}, ${code}`);
  }
  const inUs = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const [state] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  if (state === undefined || inUs / meetings.length < US_SHARE) return null;

  return {
    id: entityId(server.name, "na"),
    name: server.name,
    entity_type: "region",
    fellowship: "na",
    state,
    website: new URL(server.url).origin,
    feed_type: "bmlt",
    feed_url: url,
    verified: true,
    meeting_count: meetings.length,
    states_covered: [...counts.keys()].sort(),
    cities_covered: [...cities].sort(),
    checked_at: checkedAt,
    notes: "",
  };
}
