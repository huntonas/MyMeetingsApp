import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "../src/main";

afterEach(() => {
  vi.restoreAllMocks();
});

async function harFile(entries: unknown[]): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), "network-audit-")), "capture.har");
  await writeFile(file, JSON.stringify({ log: { entries } }));
  return file;
}

const SEARCH_ENTRY = {
  request: {
    method: "POST",
    url: "https://mymeetingapp.vercel.app/api/v1/meetings/search",
    headers: [],
    postData: { text: '{"lat":36.16,"lng":-86.78,"radiusKm":25}' },
  },
};
const BASE_ARGS = [
  "--server",
  "mymeetingapp.vercel.app",
  "--private",
  "2011-04-17",
  "--exact",
  "36.162749,-86.781602",
];

describe("run", () => {
  it("reads a capture, checks it and prints the verdict", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const file = await harFile([SEARCH_ENTRY]);
    const report = await run(["--har", file, ...BASE_ARGS, "--search-text", "Maryville, TN"]);
    expect(report.findings).toEqual([]);
    expect(log).toHaveBeenCalledWith("PASS: nothing private reached the server");
  });

  it("prints a FAIL line without repeating the leaked value or the query string", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const file = await harFile([
      { request: { method: "GET", url: "https://example.com/?d=2011-04-17", headers: [] } },
      SEARCH_ENTRY,
    ]);
    const report = await run(["--har", file, ...BASE_ARGS]);
    expect(report.findings).toEqual([{ request: "GET example.com/", problem: "contains a private value" }]);
    expect(log).toHaveBeenCalledWith("FAIL GET example.com/: contains a private value");
    expect(log).toHaveBeenCalledWith("1 problem(s) found");
    // Never print the canary itself, in any call, on any line.
    const everyLoggedLine = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(everyLoggedLine).not.toContain("2011-04-17");
  });

  it("prints a FAIL when the capture never exercised a search", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const file = await harFile([]);
    const report = await run(["--har", file, ...BASE_ARGS]);
    expect(report.findings).toEqual([
      { request: "(capture)", problem: "the capture never exercised a search" },
    ]);
    expect(log).toHaveBeenCalledWith("FAIL (capture): the capture never exercised a search");
    expect(log).toHaveBeenCalledWith("1 problem(s) found");
  });

  it("prints a 'Look at these' section without failing the run (M5)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const file = await harFile([
      {
        request: {
          method: "GET",
          url: "https://maps.example.com/tile?lat=35.9614&lng=-83.9217",
          headers: [],
        },
      },
      SEARCH_ENTRY,
    ]);
    const report = await run(["--har", file, ...BASE_ARGS]);
    expect(report.findings).toEqual([]);
    expect(log).toHaveBeenCalledWith("PASS: nothing private reached the server");
    expect(log).toHaveBeenCalledWith("Look at these (informational, doesn't fail the run):");
  });

  it("explains itself when the capture or server is missing", async () => {
    await expect(run(["--server", "mymeetingapp.vercel.app"])).rejects.toThrow(
      /^Usage: pnpm --filter network-audit check-har/,
    );
  });

  it("requires at least one --private", async () => {
    const file = await harFile([SEARCH_ENTRY]);
    await expect(
      run(["--har", file, "--server", "mymeetingapp.vercel.app", "--exact", "36.16,-86.78"]),
    ).rejects.toThrow("--private is required: give at least one canary");
  });

  it("requires at least one --exact", async () => {
    const file = await harFile([SEARCH_ENTRY]);
    await expect(
      run(["--har", file, "--server", "mymeetingapp.vercel.app", "--private", "2011-04-17"]),
    ).rejects.toThrow("--exact is required: give at least one point");
  });

  it("rejects a blank --private value", async () => {
    const file = await harFile([SEARCH_ENTRY]);
    await expect(
      run([
        "--har",
        file,
        "--server",
        "mymeetingapp.vercel.app",
        "--private",
        "  ",
        "--exact",
        "36.16,-86.78",
      ]),
    ).rejects.toThrow("--private values can't be blank");
  });

  it("rejects a blank --search-text value", async () => {
    const file = await harFile([SEARCH_ENTRY]);
    await expect(run(["--har", file, ...BASE_ARGS, "--search-text", ""])).rejects.toThrow(
      "--search-text values can't be blank",
    );
  });

  it("refuses an --exact that isn't lat,lng", async () => {
    const file = await harFile([]);
    await expect(
      run(["--har", file, "--server", "x", "--private", "2011-04-17", "--exact", "36.16"]),
    ).rejects.toThrow("--exact takes lat,lng: 36.16");
  });

  it("refuses an --exact with a blank half", async () => {
    const file = await harFile([]);
    await expect(
      run(["--har", file, "--server", "x", "--private", "2011-04-17", "--exact", "36.16,"]),
    ).rejects.toThrow("--exact takes lat,lng: 36.16,");
  });

  it("refuses a --server with a scheme", async () => {
    const file = await harFile([]);
    await expect(
      run([
        "--har",
        file,
        "--server",
        "https://mymeetingapp.vercel.app",
        "--private",
        "2011-04-17",
        "--exact",
        "36.16,-86.78",
      ]),
    ).rejects.toThrow("--server takes a bare host[:port], not a URL: https://mymeetingapp.vercel.app");
  });

  it("refuses a --server with a path", async () => {
    const file = await harFile([]);
    await expect(
      run([
        "--har",
        file,
        "--server",
        "mymeetingapp.vercel.app/api",
        "--private",
        "2011-04-17",
        "--exact",
        "36.16,-86.78",
      ]),
    ).rejects.toThrow("--server takes a bare host[:port], not a URL: mymeetingapp.vercel.app/api");
  });
});
