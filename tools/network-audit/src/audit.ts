import { MeetingSearchRequest } from "@mymeetingapp/shared";
import { z } from "zod";

import type { Har } from "./har";

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
}

type HarRequest = Har["log"]["entries"][number]["request"];

// Phase 5a's app only reads. 5b adds its write paths here, with device headers allowed on them alone.
const READS = [
  /^\/api\/v1\/config$/,
  /^\/api\/v1\/vocabulary$/,
  /^\/api\/v1\/meetings\/online\?day=[0-6]$/,
  // A real UUID shape, not just 36 characters of hex digits and hyphens in any arrangement.
  /^\/api\/v1\/meetings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
];
const SEARCH_PATH = "/api/v1/meetings/search";
const DEVICE_HEADERS = new Set(["x-device-id", "x-platform", "x-app-version", "x-attestation"]);
// Everything expo/fetch (and the OS network stack beneath it) can add on its own to a plain GET/POST JSON
// request, plus the HTTP/2 pseudo-headers a proxy may record instead of (or alongside) the real ones. Anything
// else reaching our server — a custom header, a cookie, a device header — is a finding. Documented in
// docs/mobile.md so a new header the app starts sending has to be added here deliberately.
const ALLOWED_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "user-agent",
  "content-type",
  "content-length",
  "host",
  "connection",
  "cache-control",
  "pragma",
  ":method",
  ":path",
  ":authority",
  ":scheme",
]);
// Exactly the rounded point and radius, nothing more.
const SearchBody = z.strictObject(MeetingSearchRequest.shape);

// The first three decimals of an exact coordinate, truncated and rounded, without the sign: finer than anything
// the 2-decimal rounding can produce, so a match here can only be the real, unrounded point.
function fragmentsOf(point: { latitude: number; longitude: number }): string[] {
  const truncatedAndRounded = (value: number) => {
    const abs = Math.abs(value);
    return [(Math.trunc(abs * 1000) / 1000).toFixed(3), abs.toFixed(3)];
  };
  return [...new Set([...truncatedAndRounded(point.latitude), ...truncatedAndRounded(point.longitude)])];
}

// Never throws, unlike decodeURIComponent: an invalid %zz sequence elsewhere in the string is left alone instead
// of aborting the whole decode, so a validly encoded canary next to it is still found.
function percentDecoded(text: string): string {
  return text.replace(/%[0-9a-f]{2}/gi, (match) => String.fromCharCode(parseInt(match.slice(1), 16)));
}

function jsonRoundTrip(text: string): string | undefined {
  try {
    // JSON.parse un-escapes \uXXXX; re-serializing a plain-ASCII result doesn't re-escape it, so a canary
    // hidden behind a unicode escape shows up in the stringified output as plain text.
    return JSON.stringify(JSON.parse(text));
  } catch {
    return undefined;
  }
}

// Every way a canary can hide in one piece of text: as written, percent-decoded, with a form-encoded "+"
// turned into a space and then percent-decoded, and (for JSON) unescaped by a parse/stringify round trip.
function views(raw: string): string[] {
  const plusDecoded = percentDecoded(raw.replace(/\+/g, " "));
  const json = jsonRoundTrip(raw);
  const result = [raw, percentDecoded(raw), plusDecoded];
  return json === undefined ? result : [...result, json];
}

function bodyText(request: HarRequest): string {
  const postData = request.postData;
  if (!postData) return "";
  return postData.encoding === "base64"
    ? Buffer.from(postData.text ?? "", "base64").toString("utf8")
    : (postData.text ?? "");
}

function paramsText(request: HarRequest): string {
  return (request.postData?.params ?? []).map((param) => `${param.name}=${param.value ?? ""}`).join("&");
}

function requestText(request: HarRequest): string {
  const parts = [
    request.url,
    ...request.headers.map((h) => `${h.name}: ${h.value}`),
    bodyText(request),
    paramsText(request),
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

export function auditHar(har: Har, options: AuditOptions): AuditReport {
  const findings: Finding[] = [];
  const otherHosts = new Set<string>();
  let serverRequests = 0;
  let sawSearch = false;
  const server = options.server.toLowerCase();

  for (const { request } of har.log.entries) {
    const url = new URL(request.url);
    const matchPath = `${url.pathname}${url.search}`;
    // Never the query string, never the body: a leaked canary or point must not be repeated in the report
    // that's proving it didn't leak.
    const flag = (problem: string) =>
      findings.push({ request: `${request.method} ${url.host}${url.pathname}`, problem });
    const text = requestText(request);

    for (const value of options.privateValues) {
      if (text.includes(value.toLowerCase())) flag("contains a private value");
    }
    // Checked before the other-host branch below: the app never sends the exact point anywhere, to any host,
    // since the OS geocoder only ever receives typed text, not coordinates.
    if (options.exactPoints.some((point) => fragmentsOf(point).some((fragment) => text.includes(fragment)))) {
      flag("contains an exact coordinate");
    }

    if (url.host.toLowerCase() !== server) {
      otherHosts.add(url.host);
      continue;
    }
    serverRequests += 1;

    for (const value of options.searchText) {
      if (text.includes(value.toLowerCase())) flag(`contains the search-box text "${value}"`);
    }
    for (const header of request.headers) {
      const name = header.name.toLowerCase();
      if (name === "cookie") flag("sends a Cookie header");
      else if (DEVICE_HEADERS.has(name)) flag(`sends the device header ${header.name}`);
      else if (!ALLOWED_HEADERS.has(name)) flag(`sends an unexpected header ${header.name}`);
    }
    if (request.method === "GET" && request.postData) flag("sends a body on a GET request");

    if (request.method === "POST" && matchPath === SEARCH_PATH) {
      sawSearch = true;
      if (!SearchBody.safeParse(searchBody(request)).success)
        flag("search body isn't exactly a rounded lat, lng and radiusKm");
    } else if (!(request.method === "GET" && READS.some((read) => read.test(matchPath)))) {
      flag("isn't one of the app's read requests");
    }
  }

  // A capture that never exercised a search can't prove anything about search traffic — including an empty
  // capture, or one checked against the wrong --server.
  if (!sawSearch) findings.push({ request: "(capture)", problem: "the capture never exercised a search" });

  return { serverRequests, otherHosts: [...otherHosts].sort(), findings };
}
