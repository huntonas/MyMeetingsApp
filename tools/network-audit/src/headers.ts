import { normalizeHost } from "./host";

// Every header expo/fetch (and the OS network stack beneath it) can add on its own to a plain GET/POST JSON
// request, and the value shape each one must have — pinned, not just the header name, since a coordinate or a
// canary can ride along in an otherwise-allowed header's value. Anything else reaching our server — a custom
// header, a cookie, a device header, an HTTP/2 pseudo-header (mitmdump's HAR writer never records these; one
// appearing means the capture didn't come from mitmdump, or was tampered with), or an allowed header with a
// value outside its shape — is a finding. Documented in docs/mobile.md so a new header the app starts sending
// has to be added here deliberately.

const DEVICE_HEADERS = new Set(["x-device-id", "x-platform", "x-app-version", "x-attestation"]);

export interface HeaderContext {
  method: string;
  // Already normalized (lowercased, trailing dot stripped) — see host.ts.
  server: string;
}

type HeaderValidator = (value: string, context: HeaderContext) => boolean;

const LANGUAGE_TAG = /^[a-zA-Z]{1,8}(?:-[a-zA-Z0-9]{1,8})*(?:;q=(?:0(?:\.\d+)?|1(?:\.0+)?))?$/;
const TOKEN = /^[\w-]+$/;
const USER_AGENT = /^(?:[\w.-]+\/[\w.]+ CFNetwork\/[\d.]+ Darwin\/[\d.]+|okhttp\/[\d.]+)$/;
const PRIORITY = /^u=[0-7](?:, ?i)?$/;

function commaList(value: string, isValidPart: (part: string) => boolean): boolean {
  const parts = value.split(",").map((part) => part.trim());
  return parts.length > 0 && parts.every((part) => part.length > 0 && isValidPart(part));
}

const HEADER_VALIDATORS: Record<string, HeaderValidator> = {
  host: (value, ctx) => normalizeHost(value) === ctx.server,
  accept: (value) => value === "application/json",
  "content-type": (value, ctx) => ctx.method === "POST" && value === "application/json",
  "content-length": (value) => /^\d+$/.test(value),
  "cache-control": (value) => value.toLowerCase() === "no-cache",
  pragma: (value) => value.toLowerCase() === "no-cache",
  "accept-language": (value) => commaList(value, (part) => LANGUAGE_TAG.test(part)),
  "accept-encoding": (value) => commaList(value, (part) => TOKEN.test(part)),
  "user-agent": (value) => USER_AGENT.test(value),
  priority: (value) => PRIORITY.test(value),
  connection: (value) => ["keep-alive", "close"].includes(value.toLowerCase()),
  // Vercel's ETags are content hashes shared by every client that sees the same response — not a per-person
  // identifier — so they're allowed, but only alongside a read, never a write or a search body (docs/mobile.md).
  "if-none-match": (_value, ctx) => ctx.method === "GET",
  "if-modified-since": (_value, ctx) => ctx.method === "GET",
};

// The finding for this header on a request to our server, or undefined if it's fine. An HTTP/2 pseudo-header
// (":method", ":path", ...) has no entry in HEADER_VALIDATORS below, so it falls through to the same
// "unexpected header" finding as any other name not on the allowlist — mitmdump's HAR writer never records
// these, so one appearing means the capture didn't come from mitmdump, or was tampered with.
export function headerFinding(name: string, value: string, context: HeaderContext): string | undefined {
  const lower = name.toLowerCase();
  if (lower === "cookie") return "sends a Cookie header";
  if (DEVICE_HEADERS.has(lower)) return `sends the device header ${name}`;
  const validator = HEADER_VALIDATORS[lower];
  if (!validator) return `sends an unexpected header ${name}`;
  return validator(value, context) ? undefined : `sends an unexpected value for the ${name} header`;
}
