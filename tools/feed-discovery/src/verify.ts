import { addressKey } from "@mymeetingapp/feed-kit";

import { US_STATES } from "./states";

const US_STATE_CODES = new Set(US_STATES.map((state) => state.code));

// Matches a US state code and zip in a Google-style formatted address, e.g. "Nashville, TN 37203, USA".
const STATE_IN_ADDRESS = /,\s*([A-Z]{2})\s+\d{5}/;

export interface VerifyResult {
  verified: boolean;
  meetingCount: number;
  statesCovered: string[];
  meetingKeys: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// A meeting counts toward verification (spec §4) once it has the four fields every meeting needs.
function hasRequiredFields(item: Record<string, unknown>): boolean {
  return (
    typeof item.slug === "string" &&
    typeof item.name === "string" &&
    typeof item.day === "number" &&
    typeof item.time === "string"
  );
}

// The US state code an item covers, from its own `state` field or else parsed out of
// `formatted_address`. Only codes from `US_STATES` count, so non-US codes (e.g. Ontario's "ON") and
// malformed addresses are silently ignored.
function stateFor(item: Record<string, unknown>): string | null {
  if (typeof item.state === "string" && US_STATE_CODES.has(item.state)) {
    return item.state;
  }
  if (typeof item.formatted_address === "string") {
    const match = STATE_IN_ADDRESS.exec(item.formatted_address);
    const code = match?.[1];
    if (code !== undefined && US_STATE_CODES.has(code)) {
      return code;
    }
  }
  return null;
}

// The overlap-detection key for an item, when it has a day, time and a usable address. Never written
// to disk; callers use it only in memory.
function keyFor(item: Record<string, unknown>): string | null {
  if (typeof item.day !== "number" || typeof item.time !== "string") return null;
  if (typeof item.formatted_address !== "string") return null;
  const key = addressKey(item.formatted_address);
  if (key === null) return null;
  return `${String(item.day)}|${item.time}|${key}`;
}

// Decides whether a detected feed counts as verified (spec §4: a JSON array of meetings with at least
// slug, name, day and time) and summarizes it. `body` is untrusted JSON, so every step is a runtime
// check and nothing throws on odd input.
export function verifyFeed(body: unknown): VerifyResult {
  const items = Array.isArray(body) ? body.filter(isRecord) : [];
  const verified = items.length > 0 && items.some(hasRequiredFields);

  const states = new Set<string>();
  const meetingKeys = new Set<string>();
  for (const item of items) {
    const state = stateFor(item);
    if (state !== null) states.add(state);
    const key = keyFor(item);
    if (key !== null) meetingKeys.add(key);
  }

  return {
    verified,
    meetingCount: Array.isArray(body) ? body.length : 0,
    statesCovered: [...states].sort(),
    meetingKeys,
  };
}
