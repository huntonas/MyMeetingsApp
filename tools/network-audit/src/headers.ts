import { BRAND, DEVICE_HEADERS, WriteHeaders } from "@mymeetingapp/shared";

import { normalizeHost } from "./host";

// Every header expo/fetch (and the OS network stack beneath it) can add on its own to a plain GET/POST JSON
// request, and the value shape each one must have — pinned, not just the header name, since a coordinate or a
// canary can ride along in an otherwise-allowed header's value. Anything else reaching our server — a custom
// header, a cookie, a device header, an HTTP/2 pseudo-header (mitmdump's HAR writer never records these; one
// appearing means the capture didn't come from mitmdump, or was tampered with), or an allowed header with a
// value outside its shape — is a finding. Documented in docs/mobile.md so a new header the app starts sending
// has to be added here deliberately.

const DEVICE_HEADER_NAMES = new Set(Object.values(DEVICE_HEADERS).map((name) => name.toLowerCase()));

export interface HeaderContext {
  method: string;
  // Already normalized (lowercased, trailing dot stripped) — see host.ts.
  server: string;
  // Whether this request is one of Phase 5b's writes (audit.ts's WRITES): device headers are allowed only
  // here, and only here can Content-Length legitimately be 0 (a bodiless write still gets one from the OS).
  write: boolean;
  // The request's real body size (mitmdump always records it, even with no postData). content-length must
  // equal this exactly, and is a finding at all when there's no body (bodySize is 0 or unset) — unless it's
  // a bodiless write, where 0 is expected.
  bodySize?: number;
  // etag / last-modified values an EARLIER response in this same capture returned for this exact URL: an
  // if-none-match / if-modified-since is only legitimate when it echoes one of these, never an arbitrary
  // value (Vercel's ETags are a hash of the response body, not a per-person identifier — docs/mobile.md).
  knownEtags?: ReadonlySet<string>;
  knownLastModified?: ReadonlySet<string>;
}

type HeaderValidator = (value: string, context: HeaderContext) => boolean;

// BCP47-lite: language, optional Script (Hans, Hant, ...), optional Region (US, GB, ...) or the UN M49 code
// "419" (Latin America), optional quality value. Deliberately doesn't accept the full BCP47 grammar (private-use
// subtags, extended language subtags, ...): expo/fetch only ever sends what the OS's locale settings produce,
// and a narrower shape leaves less room for a coordinate fragment to pass as a plausible-looking subtag.
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|419))?(?:;q=(?:0\.\d|1\.0))?$/;
const ACCEPT_ENCODING_TOKENS = new Set(["gzip", "deflate", "br", "zstd", "identity"]);
// APP_NAME in apps/mobile/app.config.ts is a literal kept equal to this by app-shell.test.tsx; imported here
// instead of hand-duplicated, so the two can't drift without a compile error.
const USER_AGENT_IOS = new RegExp(
  `^${BRAND.appName}/\\d+ CFNetwork/\\d+(?:\\.\\d+){0,2} Darwin/\\d+(?:\\.\\d+){0,2}$`,
);
const USER_AGENT_ANDROID = /^okhttp\/\d\.\d{1,2}\.\d{1,2}$/;
const PRIORITY = /^u=[0-7](?:, ?i)?$/;

function commaList(value: string, isValidPart: (part: string) => boolean, maxParts = Infinity): boolean {
  const parts = value.split(",").map((part) => part.trim());
  return (
    parts.length > 0 &&
    parts.length <= maxParts &&
    parts.every((part) => part.length > 0 && isValidPart(part))
  );
}

// Phase 5b's writes (audit.ts's WRITES) get their own header names, one validator per WriteHeaders field —
// looked up by the lowercased DEVICE_HEADERS name so a header's value is held to its own shape, not just its
// name being on the allowlist.
const DEVICE_HEADER_VALIDATORS: Record<string, (value: string) => boolean> = {
  [DEVICE_HEADERS.deviceId.toLowerCase()]: (value) => WriteHeaders.shape.deviceId.safeParse(value).success,
  [DEVICE_HEADERS.platform.toLowerCase()]: (value) => WriteHeaders.shape.platform.safeParse(value).success,
  [DEVICE_HEADERS.appVersion.toLowerCase()]: (value) =>
    WriteHeaders.shape.appVersion.safeParse(value).success,
};

const HEADER_VALIDATORS: Record<string, HeaderValidator> = {
  host: (value, ctx) => normalizeHost(value) === ctx.server,
  accept: (value) => value === "application/json",
  "content-type": (value, ctx) =>
    (ctx.method === "POST" || ctx.method === "PUT") &&
    (ctx.bodySize ?? 0) > 0 &&
    value === "application/json",
  "content-length": (value, ctx) =>
    value === String(ctx.bodySize ?? 0) && ((ctx.bodySize ?? 0) > 0 || ctx.write),
  "cache-control": (value) => value.toLowerCase() === "no-cache",
  pragma: (value) => value.toLowerCase() === "no-cache",
  "accept-language": (value) => commaList(value, (part) => LANGUAGE_TAG.test(part), 6),
  "accept-encoding": (value) => commaList(value, (part) => ACCEPT_ENCODING_TOKENS.has(part)),
  "user-agent": (value) => USER_AGENT_IOS.test(value) || USER_AGENT_ANDROID.test(value),
  priority: (value) => PRIORITY.test(value),
  connection: (value) => ["keep-alive", "close"].includes(value.toLowerCase()),
  "if-none-match": (value, ctx) => ctx.method === "GET" && (ctx.knownEtags?.has(value) ?? false),
  "if-modified-since": (value, ctx) => ctx.method === "GET" && (ctx.knownLastModified?.has(value) ?? false),
};

// The finding for this header on a request to our server, or undefined if it's fine. An HTTP/2 pseudo-header
// (":method", ":path", ...) has no entry in HEADER_VALIDATORS above, so it falls through to the same
// "unexpected header" finding as any other name not on the allowlist — mitmdump's HAR writer never records
// these, so one appearing means the capture didn't come from mitmdump, or was tampered with.
export function headerFinding(name: string, value: string, context: HeaderContext): string | undefined {
  const lower = name.toLowerCase();
  if (lower === "cookie") return "sends a Cookie header";
  if (DEVICE_HEADER_NAMES.has(lower)) {
    // On a read, any device header is itself a finding — spec §7 carries these on writes only.
    if (!context.write) return `sends the device header ${name}`;
    // Attestation isn't switched on until Phase 6; every other device header must match the app's own shape.
    if (lower === DEVICE_HEADERS.attestation.toLowerCase()) {
      return "sends X-Attestation, which isn't switched on yet";
    }
    const deviceValidator = DEVICE_HEADER_VALIDATORS[lower];
    return deviceValidator?.(value) ? undefined : `sends an unexpected value for the ${name} header`;
  }
  const validator = HEADER_VALIDATORS[lower];
  if (!validator) return `sends an unexpected header ${name}`;
  return validator(value, context) ? undefined : `sends an unexpected value for the ${name} header`;
}
