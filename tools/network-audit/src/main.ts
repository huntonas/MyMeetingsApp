import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { auditHar, type AuditReport } from "./audit";
import { Har } from "./har";

const USAGE =
  "Usage: pnpm --filter network-audit check-har --har <file> --server <host> --private <text>… --exact <lat,lng>… [--search-text <text>]…";

function requireNonBlank(values: string[], flag: string): void {
  for (const value of values) {
    if (value.trim() === "") throw new Error(`${flag} values can't be blank`);
  }
}

// A bare authority, never a URL: a scheme or a path would silently point the audit at the wrong thing, or hide
// that it's checking nothing at all.
function parseServer(text: string): string {
  if (text.includes("://") || text.includes("/")) {
    throw new Error(`--server takes a bare host[:port], not a URL: ${text}`);
  }
  return text;
}

function parsePoint(text: string): { latitude: number; longitude: number } {
  const parts = text.split(",");
  const [latText, lngText] = parts;
  const blank = (part: string | undefined) => part === undefined || part.trim() === "";
  if (parts.length !== 2 || blank(latText) || blank(lngText)) {
    throw new Error(`--exact takes lat,lng: ${text}`);
  }
  const latitude = Number(latText);
  const longitude = Number(lngText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`--exact takes lat,lng: ${text}`);
  }
  return { latitude, longitude };
}

export async function run(args: string[]): Promise<AuditReport> {
  const { values } = parseArgs({
    args,
    options: {
      har: { type: "string" },
      server: { type: "string" },
      private: { type: "string", multiple: true, default: [] },
      "search-text": { type: "string", multiple: true, default: [] },
      exact: { type: "string", multiple: true, default: [] },
    },
  });
  if (values.har === undefined || values.server === undefined) throw new Error(USAGE);
  // A run with no canaries can't prove anything private stayed out of the traffic: it would pass by default.
  if (values.private.length === 0) throw new Error("--private is required: give at least one canary");
  if (values.exact.length === 0) throw new Error("--exact is required: give at least one point");
  requireNonBlank(values.private, "--private");
  requireNonBlank(values["search-text"], "--search-text");

  const server = parseServer(values.server);
  const har = Har.parse(JSON.parse(await readFile(values.har, "utf8")));
  const report = auditHar(har, {
    server,
    privateValues: values.private,
    searchText: values["search-text"],
    exactPoints: values.exact.map(parsePoint),
  });
  console.log(
    `${String(report.serverRequests)} requests to ${server}; other hosts: ${report.otherHosts.join(", ") || "none"}`,
  );
  for (const finding of report.findings) console.log(`FAIL ${finding.request}: ${finding.problem}`);
  if (report.lookAt.length > 0) {
    console.log("Look at these (informational, doesn't fail the run):");
    for (const note of report.lookAt) console.log(`  ${note}`);
  }
  console.log(
    report.findings.length === 0
      ? "PASS: nothing private reached the server"
      : `${String(report.findings.length)} problem(s) found`,
  );
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const report = await run(process.argv.slice(2));
  process.exitCode = report.findings.length === 0 ? 0 : 1;
}
