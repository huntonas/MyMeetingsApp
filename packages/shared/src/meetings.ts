import { z } from "zod";

import { TagCount } from "./tags";

// Official Meeting Guide type codes (github.com/code4recovery/spec data/types.json, 2026-09).
// TC (temporarily closed) and ONL (online) are left out: `attendance` already says both.
export const MEETING_TYPE_CODES = [
  "11",
  "12x12",
  "A",
  "ABSI",
  "AF",
  "AL",
  "AL-AN",
  "AM",
  "AR",
  "ASL",
  "B",
  "BA",
  "BE",
  "BG",
  "BI",
  "BRK",
  "C",
  "CAN",
  "CF",
  "D",
  "DA",
  "DB",
  "DD",
  "DE",
  "DR",
  "EL",
  "EN",
  "FA",
  "FI",
  "FF",
  "FR",
  "G",
  "GR",
  "H",
  "HE",
  "HI",
  "HR",
  "HU",
  "IS",
  "ITA",
  "JA",
  "KA",
  "KOR",
  "L",
  "LGBTQ",
  "LIT",
  "LS",
  "LT",
  "M",
  "MED",
  "ML",
  "MT",
  "N",
  "NB",
  "NDG",
  "NE",
  "NL",
  "NO",
  "O",
  "OUT",
  "P",
  "POA",
  "POC",
  "POL",
  "POR",
  "PUN",
  "RUS",
  "S",
  "SEN",
  "SK",
  "SL",
  "SM",
  "SP",
  "ST",
  "SV",
  "T",
  "TH",
  "TL",
  "TR",
  "TUR",
  "UK",
  "W",
  "X",
  "XB",
  "XT",
  "Y",
] as const;

const ATTENDANCE_OPTIONS = ["in_person", "hybrid", "online"] as const;

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Text = z.string().nullable();
const WebUrl = z.url({ protocol: /^https?$/ }).nullable();

export const MeetingSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  day: z.number().int().min(0).max(6),
  time: ClockTime,
  endTime: ClockTime.nullable(),
  timezone: Text,
  types: z.array(z.enum(MEETING_TYPE_CODES)),
  attendance: z.enum(ATTENDANCE_OPTIONS),
  locationName: Text,
  formattedAddress: Text,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  locationNotes: Text,
  notes: Text,
  groupName: Text,
  conferenceUrl: WebUrl,
  conferenceUrlNotes: Text,
  conferencePhone: Text,
  conferencePhoneNotes: Text,
  sourceUrl: WebUrl,
  // Spec §3: the group asked not to be tagged, so the app offers no tagging and `tags` is empty.
  tagsDisabled: z.boolean(),
  tags: z.array(TagCount),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

// Spec §2: the phone rounds to 2 decimals (about 1 km) before sending; anything more precise is refused.
const roundedCoordinate = (limit: number) =>
  z
    .number()
    .min(-limit)
    .max(limit)
    .refine((value) => Math.round(value * 100) / 100 === value, "Round to 2 decimal places");

export const MeetingSearchRequest = z.object({
  lat: roundedCoordinate(90),
  lng: roundedCoordinate(180),
  radiusKm: z.number().int().min(1).max(100),
});
export type MeetingSearchRequest = z.infer<typeof MeetingSearchRequest>;

export const MeetingSearchResponse = z.object({
  meetings: z.array(MeetingSummary.extend({ distanceKm: z.number() })),
});
export type MeetingSearchResponse = z.infer<typeof MeetingSearchResponse>;

export const OnlineMeetingsQuery = z.object({
  day: z
    .string()
    .regex(/^[0-6]$/)
    .transform(Number),
});
export type OnlineMeetingsQuery = z.infer<typeof OnlineMeetingsQuery>;

export const OnlineMeetingsResponse = z.object({ meetings: z.array(MeetingSummary) });
export type OnlineMeetingsResponse = z.infer<typeof OnlineMeetingsResponse>;

export const MeetingDetailResponse = z.object({ meeting: MeetingSummary });
export type MeetingDetailResponse = z.infer<typeof MeetingDetailResponse>;
