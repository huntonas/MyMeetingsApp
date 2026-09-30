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
  // The phone's real location, set exactly in the simulator: nothing finer than 2 decimals may reach our server.
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
  /^\/api\/v1\/meetings\/[0-9a-f-]{36}$/,
];
const SEARCH_PATH = "/api/v1/meetings/search";
const DEVICE_HEADERS = new Set(["x-device-id", "x-platform", "x-app-version", "x-attestation"]);
// Exactly the rounded point and radius, nothing more.
const SearchBody = z.strictObject(MeetingSearchRequest.shape);

// The first three decimals of an exact coordinate, truncated and rounded, without the sign: finer than anything the
// 2-decimal rounding can produce.
function fragments(value: number): string[] {
  const abs = Math.abs(value);
  return [...new Set([(Math.trunc(abs * 1000) / 1000).toFixed(3), abs.toFixed(3)])];
}

function decoded(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function requestText(request: HarRequest): string {
  return [
    decoded(request.url),
    ...request.headers.map((h) => `${h.name}: ${h.value}`),
    request.postData?.text ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

function searchBody(request: HarRequest): unknown {
  try {
    return JSON.parse(request.postData?.text ?? "");
  } catch {
    return undefined;
  }
}

export function auditHar(har: Har, options: AuditOptions): AuditReport {
  const findings: Finding[] = [];
  const otherHosts = new Set<string>();
  let serverRequests = 0;
  const server = options.server.toLowerCase();
  for (const { request } of har.log.entries) {
    const url = new URL(request.url);
    const path = `${url.pathname}${url.search}`;
    const flag = (problem: string) =>
      findings.push({ request: `${request.method} ${url.host}${path}`, problem });
    const text = requestText(request);

    for (const value of options.privateValues) {
      if (text.includes(value.toLowerCase())) flag(`contains the private value "${value}"`);
    }
    // url.host is already lowercased by the URL parser; options.server is lowercased too, so a caller
    // passing mixed case still matches, and a lookalike host (a prefix or a suffix-matching subdomain
    // trick) is never treated as our server because this is exact equality, not a substring check.
    if (url.host.toLowerCase() !== server) {
      otherHosts.add(url.host);
      continue;
    }
    serverRequests += 1;
    for (const value of options.searchText) {
      if (text.includes(value.toLowerCase())) flag(`contains the search-box text "${value}"`);
    }
    for (const point of options.exactPoints) {
      for (const fragment of [...fragments(point.latitude), ...fragments(point.longitude)]) {
        if (text.includes(fragment)) flag(`contains an exact coordinate (${fragment})`);
      }
    }
    for (const header of request.headers) {
      const name = header.name.toLowerCase();
      if (name === "cookie") flag("sends a Cookie header");
      else if (DEVICE_HEADERS.has(name)) flag(`sends the device header ${header.name}`);
    }
    if (request.method === "POST" && path === SEARCH_PATH) {
      if (!SearchBody.safeParse(searchBody(request)).success)
        flag("search body isn't exactly a rounded lat, lng and radiusKm");
    } else if (!(request.method === "GET" && READS.some((read) => read.test(path)))) {
      flag("isn't one of the app's read requests");
    }
  }
  return { serverRequests, otherHosts: [...otherHosts].sort(), findings };
}
