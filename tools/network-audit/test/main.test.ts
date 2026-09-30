import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { run } from "../src/main";

async function harFile(entries: unknown[]): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), "network-audit-")), "capture.har");
  await writeFile(file, JSON.stringify({ log: { entries } }));
  return file;
}

describe("run", () => {
  it("reads a capture, checks it and prints the verdict", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const file = await harFile([
      {
        request: {
          method: "POST",
          url: "https://mymeetingapp.vercel.app/api/v1/meetings/search",
          headers: [],
          postData: { text: '{"lat":36.16,"lng":-86.78,"radiusKm":25}' },
        },
      },
    ]);
    const report = await run([
      "--har",
      file,
      "--server",
      "mymeetingapp.vercel.app",
      "--private",
      "2011-04-17",
      "--search-text",
      "Maryville, TN",
      "--exact",
      "36.162749,-86.781602",
    ]);
    expect(report.findings).toEqual([]);
    expect(log).toHaveBeenCalledWith("PASS: nothing private reached the server");
  });

  it("prints each finding and fails the verdict when something turns up", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const file = await harFile([
      { request: { method: "GET", url: "https://example.com/?d=2011-04-17", headers: [] } },
    ]);
    const report = await run([
      "--har",
      file,
      "--server",
      "mymeetingapp.vercel.app",
      "--private",
      "2011-04-17",
    ]);
    expect(report.findings).toEqual([
      { request: "GET example.com/?d=2011-04-17", problem: 'contains the private value "2011-04-17"' },
    ]);
    expect(log).toHaveBeenCalledWith(
      'FAIL GET example.com/?d=2011-04-17: contains the private value "2011-04-17"',
    );
    expect(log).toHaveBeenCalledWith("1 problem(s) found");
  });

  it("explains itself when the capture or server is missing", async () => {
    await expect(run(["--server", "mymeetingapp.vercel.app"])).rejects.toThrow(
      /^Usage: pnpm --filter network-audit check-har/,
    );
  });

  it("refuses an --exact that isn't lat,lng", async () => {
    const file = await harFile([]);
    await expect(run(["--har", file, "--server", "x", "--exact", "36.16"])).rejects.toThrow(
      "--exact takes lat,lng: 36.16",
    );
  });
});
