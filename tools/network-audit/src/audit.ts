import {
  DEVICE_HEADERS,
  MeetingSearchRequest,
  SuggestionRequest,
  TagEditRequest,
  TagSubmissionRequest,
} from "@mymeetingapp/shared";
import { z } from "zod";

import { views } from "./decode";
import type { Har } from "./har";
import { headerFinding } from "./headers";
import { classifyHost, normalizeHost } from "./host";
import { isPrivateOrLoopbackHost, looksLikeCoordinatePair } from "./lookat";

export interface AuditOptions {
  // Our server's host as it appears in URLs (mymeetingapp.vercel.app, or 192.168.x.y:3000 for local web).
  server: string;
  // Never in any request to any host: the sobriety date and other personal data set as canaries (spec §2).
  privateValues: string[];
  // Typed into the search box: the phone's geocoder may send it to Apple or Google, but never to our server (spec §8).
  searchText: string[];
  // The phone's real location, set exactly in the simulator: nothing finer than 2 decimals may reach our server,
  // and the exact point itself must never reach any host at all (the OS geocoder only ever gets typed text).
  exactPoints: { latitude: number; longitude: number }[];
}

interface Finding {
  request: string;
  problem: string;
}

export interface AuditReport {
  serverRequests: number;
  otherHosts: string[];
  findings: Finding[];
  // Worth a human glance, but not a failure — see src/lookat.ts.
  lookAt: string[];
  // Every distinct user-agent value seen on a request to our server, printed for a human to confirm. More
  // than one is also a finding: the app sends exactly one, so a second means something else is talking to
  // the server (or the capture mixes two devices/runs together).
  userAgents: string[];
  // How many of serverRequests matched one of Phase 5b's writes (WRITES, below).
  writeRequests: number;
}

type HarEntry = Har["log"]["entries"][number];
type HarRequest = HarEntry["request"];

// Phase 5a's app only reads. 5b adds its write paths here, with device headers allowed on them alone.
const READS = [
  /^\/api\/v1\/config$/,
  /^\/api\/v1\/vocabulary$/,
  /^\/api\/v1\/meetings\/online\?day=[0-6]$/,
  // A real UUID shape, not just 36 characters of hex digits and hyphens in any arrangement.
  /^\/api\/v1\/meetings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
];
const SEARCH_PATH = "/api/v1/meetings/search";
// Exactly the rounded point and radius, nothing more.
const SearchBody = z.strictObject(MeetingSearchRequest.shape);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Phase 5b's writes, each with exactly the body the app sends (JSON.stringify of its contract's parse), or
// none. A write's shape is otherwise checked exactly like search's: body === null means the request must have
// no body at all; any other body must strict-parse and re-stringify byte-for-byte to what's on the wire.
const WRITES: { method: string; path: RegExp; body: z.ZodType | null }[] = [
  { method: "POST", path: /^\/api\/v1\/tags$/, body: z.strictObject(TagSubmissionRequest.shape) },
  {
    method: "PUT",
    path: new RegExp(`^/api/v1/tags/${UUID}$`, "i"),
    body: z.strictObject(TagEditRequest.shape),
  },
  { method: "DELETE", path: new RegExp(`^/api/v1/tags/${UUID}$`, "i"), body: null },
  { method: "POST", path: /^\/api\/v1\/tags\/delete-mine$/, body: null },
  { method: "POST", path: /^\/api\/v1\/suggestions$/, body: z.strictObject(SuggestionRequest.shape) },
];
// Spec §7: every write carries these three; the fourth, X-Attestation, is still off (headers.ts).
const REQUIRED_DEVICE_HEADERS = [
  DEVICE_HEADERS.deviceId,
  DEVICE_HEADERS.platform,
  DEVICE_HEADERS.appVersion,
].map((name) => name.toLowerCase());

// The first three decimals of an exact coordinate, truncated and rounded, without the sign: finer than
// anything the 2-decimal rounding can produce, so a match here can only be the real, unrounded point. `exact`
// holds the dotted form and the comma decimal separator (some locales). `dotless` holds the dot stripped (a
// microdegree-style truncation): those digits also turn up in timestamps and ids in unrelated traffic, so only
// our server fails on them; anywhere else they're a look-at note.
function fragmentsOf(point: { latitude: number; longitude: number }) {
  const truncatedAndRounded = (value: number) => {
    const abs = Math.abs(value);
    return [(Math.trunc(abs * 1000) / 1000).toFixed(3), abs.toFixed(3)];
  };
  const base = [
    ...new Set([...truncatedAndRounded(point.latitude), ...truncatedAndRounded(point.longitude)]),
  ];
  return {
    exact: base.flatMap((fragment) => [fragment, fragment.replace(".", ",")]),
    dotless: base.map((fragment) => fragment.replace(".", "")),
  };
}

function bodyText(request: HarRequest): string {
  const postData = request.postData;
  if (!postData) return "";
  return postData.encoding === "base64"
    ? Buffer.from(postData.text ?? "", "base64").toString("utf8")
    : (postData.text ?? "");
}

function paramsText(request: HarRequest): string {
  return (request.postData?.params ?? [])
    .map((param) => `${param.name}=${param.value ?? ""} ${param.fileName ?? ""} ${param.contentType ?? ""}`)
    .join("&");
}

function cookiesText(request: HarRequest): string {
  return (request.cookies ?? []).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function webSocketText(entry: HarEntry): string {
  return (entry._webSocketMessages ?? []).map((message) => message.data).join("\n");
}

function requestText(entry: HarEntry): string {
  const { request } = entry;
  const parts = [
    request.url,
    ...request.headers.map((h) => `${h.name}: ${h.value}`),
    bodyText(request),
    paramsText(request),
    cookiesText(request),
    webSocketText(entry),
  ];
  return parts.flatMap(views).join("\n").toLowerCase();
}

function searchBody(request: HarRequest): unknown {
  try {
    return JSON.parse(bodyText(request));
  } catch {
    return undefined;
  }
}

// The app sends JSON.stringify(schema.parse(request)) (apps/mobile/src/api/reads.ts and writes.ts): parsing
// to valid values isn't enough on its own — a duplicate JSON key JSON.parse silently collapses, or a number
// with far more precision than a double can hold, can still parse to a valid rounded value while the raw
// bytes on the wire were never what the app would have sent. Byte-for-byte comparison catches both. Used for
// the search body (always SearchBody) and every write that has one (WRITES, above).
function isExactlyTheAppsBody(schema: z.ZodType, request: HarRequest): boolean {
  const parsed = schema.safeParse(searchBody(request));
  return parsed.success && JSON.stringify(parsed.data) === bodyText(request);
}

// Whether the app has any invisible body at all: mitmdump's savehar.py only ever writes postData for POST,
// PUT and PATCH, but always writes bodySize — so a body on a GET (or one too large for mitmdump to capture)
// shows up as bodySize > 0 with no postData, never as postData on a GET.
function hasUnrecordedBody(request: HarRequest): boolean {
  return (request.bodySize ?? 0) > 0 && !request.postData;
}

function hasAnyBody(request: HarRequest): boolean {
  return request.postData !== undefined || (request.bodySize ?? 0) > 0;
}

// Whether a write whose contract has no body actually carries one. mitmdump's savehar.py writes a postData
// object with an empty text and params for every POST, even a bodiless one, so postData !== undefined (what
// hasAnyBody checks) isn't enough here — it would fail every real delete-mine capture.
function hasBodyForWrite(request: HarRequest): boolean {
  return (
    bodyText(request) !== "" || (request.postData?.params?.length ?? 0) > 0 || (request.bodySize ?? 0) > 0
  );
}

interface UrlHistory {
  etags: Set<string>;
  lastModified: Set<string>;
}

function historyFor(map: Map<string, UrlHistory>, url: string): UrlHistory {
  let found = map.get(url);
  if (!found) {
    found = { etags: new Set(), lastModified: new Set() };
    map.set(url, found);
  }
  return found;
}

export function auditHar(har: Har, options: AuditOptions): AuditReport {
  const findings: Finding[] = [];
  const otherHosts = new Set<string>();
  const lookAt: string[] = [];
  const userAgents = new Set<string>();
  // Never printed — only its cardinality matters (more than one device in a capture meant to prove one
  // phone's traffic is clean is itself suspicious).
  const deviceIds = new Set<string>();
  const urlHistory = new Map<string, UrlHistory>();
  let serverRequests = 0;
  let writeRequests = 0;
  let sawSearch = false;
  const normalizedServer = normalizeHost(options.server);

  for (const entry of har.log.entries) {
    const { request } = entry;
    const url = new URL(request.url);
    const matchPath = `${url.pathname}${url.search}`;
    // Never the query string, never the body: a leaked canary or point must not be repeated in the report
    // that's proving it didn't leak.
    const flag = (problem: string) =>
      findings.push({ request: `${request.method} ${url.host}${url.pathname}`, problem });
    const text = requestText(entry);

    // A snapshot of what earlier entries to this same URL have returned, taken before this entry's own
    // response (below) is added — so a request can never legitimize itself with its own response.
    const history = historyFor(urlHistory, url.href);
    const knownEtags = new Set(history.etags);
    const knownLastModified = new Set(history.lastModified);
    for (const responseHeader of entry.response?.headers ?? []) {
      const name = responseHeader.name.toLowerCase();
      if (name === "etag") history.etags.add(responseHeader.value);
      if (name === "last-modified") history.lastModified.add(responseHeader.value);
    }

    for (const value of options.privateValues) {
      if (text.includes(value.toLowerCase())) flag("contains a private value");
    }
    // Checked before the host branch below: the app never sends the exact point anywhere, to any host, since
    // the OS geocoder only ever receives typed text, not coordinates.
    const fragments = options.exactPoints.map(fragmentsOf);
    const hasExact = fragments.some(({ exact }) => exact.some((fragment) => text.includes(fragment)));
    if (hasExact) flag("contains an exact coordinate");
    const hasDotless = fragments.some(({ dotless }) => dotless.some((fragment) => text.includes(fragment)));
    // Also checked for every host: an invisible body is unaccounted for regardless of who received it.
    if (hasUnrecordedBody(request)) flag("body not recorded, can't be scanned");

    const hostMatch = classifyHost(url, options.server);
    if (hostMatch === "differentWay") {
      // Neither ours nor "other": letting this slip into otherHosts would skip every check below, including
      // the Cookie header this exact bypass is meant to smuggle past.
      flag("our server reached a different way");
      continue;
    }
    if (hostMatch === "other") {
      otherHosts.add(url.host);
      if (hasDotless) {
        lookAt.push(
          `${request.method} ${url.host}${url.pathname}: has an exact coordinate's digits without the dot`,
        );
      }
      if (looksLikeCoordinatePair(text)) {
        lookAt.push(`${request.method} ${url.host}${url.pathname}: looks like a coordinate pair`);
      }
      if (url.protocol === "http:" && !isPrivateOrLoopbackHost(url.hostname)) {
        lookAt.push(`${request.method} ${url.host}${url.pathname}: plain http to a public host`);
      }
      continue;
    }
    serverRequests += 1;
    if (hasDotless && !hasExact) flag("contains an exact coordinate");

    for (const value of options.searchText) {
      if (text.includes(value.toLowerCase())) flag(`contains the search-box text "${value}"`);
    }
    const write = WRITES.find(
      (candidate) => candidate.method === request.method && candidate.path.test(matchPath),
    );
    for (const header of request.headers) {
      const lower = header.name.toLowerCase();
      if (lower === "user-agent") userAgents.add(header.value);
      if (lower === DEVICE_HEADERS.deviceId.toLowerCase()) deviceIds.add(header.value);
      const problem = headerFinding(header.name, header.value, {
        method: request.method,
        server: normalizedServer,
        bodySize: request.bodySize,
        knownEtags,
        knownLastModified,
        write: write !== undefined,
      });
      if (problem) flag(problem);
    }
    if ((request.cookies ?? []).some((cookie) => cookie.value !== "")) flag("sends a Cookie header");
    if (request.method !== "POST" && !write && hasAnyBody(request)) {
      flag(`sends a body on a ${request.method} request`);
    }

    if (request.method === "POST" && matchPath === SEARCH_PATH) {
      sawSearch = true;
      if (!isExactlyTheAppsBody(SearchBody, request))
        flag("search body isn't exactly a rounded lat, lng and radiusKm");
    } else if (write) {
      writeRequests += 1;
      for (const required of REQUIRED_DEVICE_HEADERS) {
        if (!request.headers.some((header) => header.name.toLowerCase() === required)) {
          flag(`write without the ${required} header`);
        }
      }
      if (write.body === null) {
        if (hasBodyForWrite(request)) flag("sends a body on a write that has none");
      } else if (!isExactlyTheAppsBody(write.body, request)) {
        flag("write body isn't exactly what the app sends");
      }
    } else if (!(request.method === "GET" && READS.some((read) => read.test(matchPath)))) {
      flag("isn't one of the app's requests");
    }
  }

  // A capture that never exercised a search can't prove anything about search traffic — including an empty
  // capture, or one checked against the wrong --server.
  if (!sawSearch) findings.push({ request: "(capture)", problem: "the capture never exercised a search" });
  // The app sends exactly one user-agent value; more than one means something else reached the server, or the
  // capture mixes more than one device or run together.
  if (userAgents.size > 1) {
    findings.push({ request: "(capture)", problem: "sends more than one distinct user-agent value" });
  }
  // The app's writes carry exactly one phone's device ID; more than one means the capture mixes devices, or a
  // device header was forged — never say which values, since that's the thing being kept private.
  if (deviceIds.size > 1) {
    findings.push({ request: "(capture)", problem: "sends more than one device ID" });
  }

  return {
    serverRequests,
    otherHosts: [...otherHosts].sort(),
    findings,
    lookAt,
    userAgents: [...userAgents],
    writeRequests,
  };
}
