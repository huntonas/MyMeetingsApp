import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { auditHar, type AuditReport } from "./audit";
import { Har } from "./har";

const USAGE =
  "Usage: pnpm --filter network-audit check-har --har <file> --server <host> [--private <text>]… [--search-text <text>]… [--exact <lat,lng>]…";

function parsePoint(text: string): { latitude: number; longitude: number } {
  const [latitude, longitude, extra] = text.split(",").map(Number);
  if (
    latitude === undefined ||
    longitude === undefined ||
    extra !== undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
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
  const har = Har.parse(JSON.parse(await readFile(values.har, "utf8")));
  const report = auditHar(har, {
    server: values.server,
    privateValues: values.private,
    searchText: values["search-text"],
    exactPoints: values.exact.map(parsePoint),
  });
  console.log(
    `${String(report.serverRequests)} requests to ${values.server}; other hosts: ${report.otherHosts.join(", ") || "none"}`,
  );
  for (const finding of report.findings) console.log(`FAIL ${finding.request}: ${finding.problem}`);
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
