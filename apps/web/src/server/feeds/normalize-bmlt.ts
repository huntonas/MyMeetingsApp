import { addressKey } from "@mymeetingapp/feed-kit";
import type { MeetingTypeCode } from "@mymeetingapp/shared";

import {
  clockTime,
  type FeedMeeting,
  FeedFormatError,
  point,
  text,
  timeZone,
  webUrl,
} from "@/server/feeds/normalize";

type Raw = Record<string, unknown>;

// NAWS's standard format ids (world_id), the same on every server whatever letters it shows (NA design, §1).
const TYPE_BY_WORLD_ID: Partial<Record<string, MeetingTypeCode>> = {
  OPEN: "O",
  CLOSED: "C",
  DISC: "D",
  SPK: "SP",
  STEP: "ST",
  BEG: "BE",
  W: "W",
  M: "M",
  Y: "Y",
  GL: "LGBTQ",
  MED: "MED",
  WCHR: "X",
  CW: "CF",
  LIT: "LIT",
  TRAD: "TR",
  CAN: "CAN",
  BT: "BT",
  JFT: "JFT",
  IW: "IW",
  SWG: "SWG",
};
const TEMPORARILY_CLOSED = "TC";
const VENUE = { inPerson: "1", virtual: "2" } as const;
const MINUTES_PER_DAY = 24 * 60;

const withoutSlash = (uri: string) => uri.replace(/\/+$/, "");

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minutesOf(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

// BMLT gives a start and a duration; the end may fall after midnight.
function endTime(start: string, duration: unknown): string | null {
  const length = clockTime(duration);
  if (length === null || minutesOf(length) === 0) return null;
  const end = (minutesOf(start) + minutesOf(length)) % MINUTES_PER_DAY;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function address(raw: Raw): string | null {
  const stateAndZip = [text(raw.location_province), text(raw.location_postal_code_1)]
    .filter((part) => part !== null)
    .join(" ");
  const parts = [text(raw.location_street), text(raw.location_municipality), text(stateAndZip)].filter(
    (part) => part !== null,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeRow(raw: Raw, worldIds: Map<string, string>): FeedMeeting | null {
  const sourceSlug = text(raw.id_bigint);
  const name = text(raw.meeting_name);
  const time = clockTime(raw.start_time);
  const weekday = Number(text(raw.weekday_tinyint));
  if (sourceSlug === null || name === null || time === null || !(weekday >= 1 && weekday <= 7)) return null;

  const formats = (text(raw.formats) ?? "").split(",").map((key) => worldIds.get(key.trim()));
  const venue = text(raw.venue_type);
  // An in-person venue's leftover link isn't a way to join it.
  const conferenceUrl = venue === VENUE.inPerson ? null : webUrl(raw.virtual_meeting_link);
  const conferencePhone = venue === VENUE.inPerson ? null : text(raw.phone_meeting_number);
  const online = conferenceUrl !== null || conferencePhone !== null;
  // A virtual meeting's address is only where its group is based, which must not become a map pin.
  const formattedAddress = venue === VENUE.virtual ? null : address(raw);
  const location = venue === VENUE.virtual ? null : point(raw);
  const inPerson =
    venue !== VENUE.virtual &&
    !formats.includes(TEMPORARILY_CLOSED) &&
    (formattedAddress !== null || location !== null);
  if (!inPerson && !online) return null;

  return {
    sourceSlug,
    day: weekday - 1,
    time,
    endTime: endTime(time, raw.duration_time),
    timezone: timeZone(raw.time_zone),
    name,
    types: [
      ...new Set(
        formats
          .map((worldId) => (worldId === undefined ? undefined : TYPE_BY_WORLD_ID[worldId]))
          .filter((code) => code !== undefined),
      ),
    ],
    attendance: inPerson ? (online ? "hybrid" : "in_person") : "online",
    locationName: text(raw.location_text),
    formattedAddress,
    addressKey: addressKey(formattedAddress),
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    locationNotes: text(raw.location_info),
    notes: text(raw.comments),
    groupName: null,
    conferenceUrl,
    conferenceUrlNotes: null,
    conferencePhone,
    conferencePhoneNotes: null,
    sourceUrl: null,
  };
}

// Spec §3 allowlist, as normalizeFeed: only the fields above are read. A BMLT answer asked for with
// get_used_formats=1 is { meetings, formats }. Only rows from the feed's own root server are kept, since an
// aggregator or a zonal server also answers for other servers.
export function normalizeBmlt(json: unknown, feedUrl: string): { meetings: FeedMeeting[]; skipped: number } {
  if (!isObject(json) || !Array.isArray(json.meetings) || !Array.isArray(json.formats)) {
    throw new FeedFormatError("Feed is not a BMLT answer with meetings and formats");
  }
  const worldIds = new Map<string, string>();
  for (const format of json.formats as unknown[]) {
    if (!isObject(format)) continue;
    const key = text(format.key_string);
    const worldId = text(format.world_id);
    if (key !== null && worldId !== null) worldIds.set(key, worldId);
  }
  const root = withoutSlash(feedUrl.slice(0, feedUrl.indexOf("client_interface")));
  const meetings: FeedMeeting[] = [];
  let skipped = 0;
  for (const item of json.meetings as unknown[]) {
    const from = isObject(item) ? text(item.root_server_uri) : null;
    if (from !== null && withoutSlash(from) !== root) continue;
    const meeting = isObject(item) ? normalizeRow(item, worldIds) : null;
    if (meeting === null) skipped += 1;
    else meetings.push(meeting);
  }
  return { meetings, skipped };
}
