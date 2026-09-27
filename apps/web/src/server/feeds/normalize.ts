import { MEETING_TYPE_CODES, type MeetingSummary } from "@mymeetingapp/shared";

import { addressKey } from "@/server/feeds/address";

export interface FeedMeeting {
  sourceSlug: string;
  day: number;
  time: string;
  endTime: string | null;
  timezone: string | null;
  name: string;
  types: MeetingSummary["types"];
  attendance: MeetingSummary["attendance"];
  locationName: string | null;
  formattedAddress: string | null;
  addressKey: string | null;
  latitude: number | null;
  longitude: number | null;
  locationNotes: string | null;
  notes: string | null;
  groupName: string | null;
  conferenceUrl: string | null;
  conferenceUrlNotes: string | null;
  conferencePhone: string | null;
  conferencePhoneNotes: string | null;
  sourceUrl: string | null;
}

export class FeedFormatError extends Error {
  override name = "FeedFormatError";
}

type Raw = Record<string, unknown>;

const TEXT_LIMIT = 1000;
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TYPE_BY_UPPER = new Map(MEETING_TYPE_CODES.map((code) => [code.toUpperCase(), code]));

function text(value: unknown): string | null {
  const candidate = typeof value === "number" ? String(value) : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed === "" ? null : trimmed.slice(0, TEXT_LIMIT);
}

function webUrl(value: unknown): string | null {
  const candidate = text(value);
  if (candidate === null || !/^https?:\/\//i.test(candidate)) return null;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function days(value: unknown): number[] {
  const found = new Set<number>();
  for (const item of Array.isArray(value) ? value : [value]) {
    const name = text(item)?.toLowerCase();
    const day =
      typeof item === "number"
        ? item
        : name !== undefined && /^\d$/.test(name)
          ? Number(name)
          : DAY_NAMES.indexOf(name ?? "");
    if (Number.isInteger(day) && day >= 0 && day <= 6) found.add(day);
  }
  return [...found];
}

function clockTime(value: unknown): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text(value) ?? "");
  if (match === null) return null;
  const [, hours = "", minutes = ""] = match;
  if (Number(hours) > 23 || Number(minutes) > 59) return null;
  return `${hours.padStart(2, "0")}:${minutes}`;
}

function timeZone(value: unknown): string | null {
  const zone = text(value);
  if (!zone?.includes("/")) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function coordinate(value: unknown, limit: number): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function point(raw: Raw): { latitude: number; longitude: number } | null {
  let latitude = coordinate(raw.latitude, 90);
  let longitude = coordinate(raw.longitude, 180);
  if ((latitude === null || longitude === null) && typeof raw.coordinates === "string") {
    const parts = raw.coordinates.split(",");
    if (parts.length === 2) {
      latitude = coordinate(parts[0], 90);
      longitude = coordinate(parts[1], 180);
    }
  }
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

// Online meetings often carry a city-level "approximate" location, which must not become a map pin.
function isApproximate(raw: Raw): boolean {
  if (raw.approximate === true || text(raw.approximate)?.toLowerCase() === "yes") return true;
  return typeof raw.coordinates === "string" && raw.coordinates.split(",").length === 4;
}

function address(raw: Raw): string | null {
  const formatted = text(raw.formatted_address);
  if (formatted !== null) return formatted;
  const stateAndZip = [text(raw.state), text(raw.postal_code)].filter((part) => part !== null).join(" ");
  const parts = [text(raw.address), text(raw.city), text(stateAndZip), text(raw.country)].filter(
    (part) => part !== null,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function rawTypes(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return values.map((item) => text(item)?.toUpperCase()).filter((code) => code !== undefined);
}

function normalizeMeeting(value: unknown): FeedMeeting[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const raw = value as Raw;
  const sourceSlug = text(raw.slug);
  const name = text(raw.name);
  const time = clockTime(raw.time);
  const meetingDays = days(raw.day);
  if (sourceSlug === null || name === null || time === null || meetingDays.length === 0) return [];

  const upperTypes = rawTypes(raw.types);
  const approximate = isApproximate(raw);
  const formattedAddress = approximate ? null : address(raw);
  const location = approximate ? null : point(raw);
  const conferenceUrl = webUrl(raw.conference_url);
  const conferencePhone = text(raw.conference_phone);
  const online = conferenceUrl !== null || conferencePhone !== null;
  const inPerson = !upperTypes.includes("TC") && (formattedAddress !== null || location !== null);
  if (!inPerson && !online) return [];

  const meeting: Omit<FeedMeeting, "day"> = {
    sourceSlug,
    time,
    endTime: clockTime(raw.end_time),
    timezone: timeZone(raw.timezone),
    name,
    types: [
      ...new Set(upperTypes.map((code) => TYPE_BY_UPPER.get(code)).filter((code) => code !== undefined)),
    ],
    attendance: inPerson ? (online ? "hybrid" : "in_person") : "online",
    locationName: text(raw.location),
    formattedAddress,
    addressKey: addressKey(formattedAddress),
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    locationNotes: text(raw.location_notes),
    notes: text(raw.notes),
    groupName: text(raw.group),
    conferenceUrl,
    conferenceUrlNotes: text(raw.conference_url_notes),
    conferencePhone,
    conferencePhoneNotes: text(raw.conference_phone_notes),
    sourceUrl: webUrl(raw.url),
  };
  return meetingDays.map((day) => ({ ...meeting, day }));
}

// Spec §3 allowlist: only the fields above are read, so contact and payment fields never enter the system.
export function normalizeFeed(json: unknown): { meetings: FeedMeeting[]; skipped: number } {
  if (!Array.isArray(json)) throw new FeedFormatError("Feed is not a JSON array of meetings");
  const meetings: FeedMeeting[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const item of json) {
    const rows = normalizeMeeting(item);
    if (rows.length === 0) skipped += 1;
    for (const row of rows) {
      const key = `${row.sourceSlug}|${String(row.day)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      meetings.push(row);
    }
  }
  return { meetings, skipped };
}
