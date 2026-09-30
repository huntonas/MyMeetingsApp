import { MeetingSearchRequest } from "@mymeetingapp/shared";
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

// The first three decimals of an exact coordinate, truncated and rounded, without the sign: finer than
// anything the 2-decimal rounding can produce, so a match here can only be the real, unrounded point. Also
// tried with the dot stripped (a microdegree-style truncation) and with a comma decimal separator (some
// locales) — a false positive from either fails closed, which is acceptable.
function fragmentsOf(point: { latitude: number; longitude: number }): string[] {
  const truncatedAndRounded = (value: number) => {
    const abs = Math.abs(value);
    return [(Math.trunc(abs * 1000) / 1000).toFixed(3), abs.toFixed(3)];
  };
  const base = [
    ...new Set([...truncatedAndRounded(point.latitude), ...truncatedAndRounded(point.longitude)]),
  ];
  return [
    ...new Set(base.flatMap((fragment) => [fragment, fragment.replace(".", ""), fragment.replace(".", ",")])),
  ];
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

// The app sends JSON.stringify(MeetingSearchRequest.parse(request)) (apps/mobile/src/api/reads.ts): parsing
// to valid values isn't enough on its own — a duplicate JSON key JSON.parse silently collapses, or a number
// with far more precision than a double can hold, can still parse to a valid rounded value while the raw
// bytes on the wire were never what the app would have sent. Byte-for-byte comparison catches both.
function isExactlyTheAppsSearchBody(request: HarRequest): boolean {
  const parsed = SearchBody.safeParse(searchBody(request));
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

export function auditHar(har: Har, options: AuditOptions): AuditReport {
  const findings: Finding[] = [];
  const otherHosts = new Set<string>();
  const lookAt: string[] = [];
  let serverRequests = 0;
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

    for (const value of options.privateValues) {
      if (text.includes(value.toLowerCase())) flag("contains a private value");
    }
    // Checked before the host branch below: the app never sends the exact point anywhere, to any host, since
    // the OS geocoder only ever receives typed text, not coordinates.
    if (options.exactPoints.some((point) => fragmentsOf(point).some((fragment) => text.includes(fragment)))) {
      flag("contains an exact coordinate");
    }
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
      if (looksLikeCoordinatePair(text)) {
        lookAt.push(`${request.method} ${url.host}${url.pathname}: looks like a coordinate pair`);
      }
      if (url.protocol === "http:" && !isPrivateOrLoopbackHost(url.hostname)) {
        lookAt.push(`${request.method} ${url.host}${url.pathname}: plain http to a public host`);
      }
      continue;
    }
    serverRequests += 1;

    for (const value of options.searchText) {
      if (text.includes(value.toLowerCase())) flag(`contains the search-box text "${value}"`);
    }
    for (const header of request.headers) {
      const problem = headerFinding(header.name, header.value, {
        method: request.method,
        server: normalizedServer,
      });
      if (problem) flag(problem);
    }
    if ((request.cookies ?? []).some((cookie) => cookie.value !== "")) flag("sends a Cookie header");
    if (request.method !== "POST" && hasAnyBody(request)) flag("sends a body on a GET request");

    if (request.method === "POST" && matchPath === SEARCH_PATH) {
      sawSearch = true;
      if (!isExactlyTheAppsSearchBody(request))
        flag("search body isn't exactly a rounded lat, lng and radiusKm");
    } else if (!(request.method === "GET" && READS.some((read) => read.test(matchPath)))) {
      flag("isn't one of the app's read requests");
    }
  }

  // A capture that never exercised a search can't prove anything about search traffic — including an empty
  // capture, or one checked against the wrong --server.
  if (!sawSearch) findings.push({ request: "(capture)", problem: "the capture never exercised a search" });

  return { serverRequests, otherHosts: [...otherHosts].sort(), findings, lookAt };
}
