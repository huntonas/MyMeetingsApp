import { describe, expect, it } from "vitest";

import { auditHar } from "../src/audit";
import type { Har } from "../src/har";

const SERVER = "mymeetingapp.vercel.app";
const OPTIONS = {
  server: SERVER,
  privateValues: ["2011-04-17", "Apr 17, 2011"],
  searchText: ["Maryville, TN"],
  exactPoints: [{ latitude: 36.162749, longitude: -86.781602 }],
};

function entry(method: string, url: string, extra: { headers?: [string, string][]; body?: string } = {}) {
  return {
    request: {
      method,
      url,
      headers: (extra.headers ?? []).map(([name, value]) => ({ name, value })),
      ...(extra.body === undefined ? {} : { postData: { text: extra.body } }),
    },
  };
}

const har = (...entries: ReturnType<typeof entry>[]): Har => ({ log: { entries } });
const search = (body: string) => entry("POST", `https://${SERVER}/api/v1/meetings/search`, { body });
const problems = (capture: Har) => auditHar(capture, OPTIONS).findings.map((finding) => finding.problem);

describe("auditHar", () => {
  it("passes the app's five read requests, and lists other hosts for review", () => {
    const report = auditHar(
      har(
        entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["accept", "application/json"]] }),
        entry("GET", `https://${SERVER}/api/v1/vocabulary`),
        entry("GET", `https://${SERVER}/api/v1/meetings/online?day=1`),
        entry("GET", `https://${SERVER}/api/v1/meetings/0f8fad5b-d9cb-469f-a165-70867728950e`),
        search('{"lat":36.16,"lng":-86.78,"radiusKm":25}'),
        entry("GET", "https://gsp-ssl.ls.apple.com/geocode?q=Maryville%2C%20TN"),
      ),
      OPTIONS,
    );
    expect(report).toEqual({ serverRequests: 5, otherHosts: ["gsp-ssl.ls.apple.com"], findings: [] });
  });

  it("flags coordinates in a URL on the search endpoint", () => {
    expect(
      problems(
        har(entry("POST", `https://${SERVER}/api/v1/meetings/search?lat=36.16&lng=-86.78`, { body: "{}" })),
      ),
    ).toContain("isn't one of the app's read requests");
  });

  it("flags coordinates added to the query string of an otherwise-valid read", () => {
    expect(problems(har(entry("GET", `https://${SERVER}/api/v1/vocabulary?lat=36.16&lng=-86.78`)))).toContain(
      "isn't one of the app's read requests",
    );
  });

  it("flags an unrounded point, and the exact coordinate in it", () => {
    const found = problems(har(search('{"lat":36.162749,"lng":-86.78,"radiusKm":25}')));
    expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
    expect(found).toContain("contains an exact coordinate (36.162)");
  });

  it("flags a 3-decimal point even when it doesn't match a known exact canary", () => {
    // 36.171 isn't derived from any --exact point (its truncated/rounded fragments are 36.171/36.172,
    // not the canary's 36.162/36.163), so only the schema check, not fragment matching, can catch it.
    // A mutant that weakens rounding to 3 decimals would let this test pass.
    const found = problems(har(search('{"lat":36.171,"lng":-86.78,"radiusKm":25}')));
    expect(found).toEqual(["search body isn't exactly a rounded lat, lng and radiusKm"]);
  });

  it("flags a rounded coordinate sent as a string instead of a number", () => {
    const found = problems(har(search('{"lat":"36.16","lng":-86.78,"radiusKm":25}')));
    expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
  });

  it("flags anything extra in the search body, such as the search text", () => {
    const found = problems(har(search('{"lat":36.16,"lng":-86.78,"radiusKm":25,"query":"Maryville, TN"}')));
    expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
    expect(found).toContain('contains the search-box text "Maryville, TN"');
  });

  it("flags a coordinate nested inside an extra object in the search body", () => {
    const found = problems(
      har(search('{"lat":36.16,"lng":-86.78,"radiusKm":25,"origin":{"lat":36.162749,"lng":-86.781602}}')),
    );
    expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
    expect(found).toContain("contains an exact coordinate (36.162)");
  });

  it("flags a device header on a read", () => {
    expect(
      problems(
        har(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["X-Device-Id", "abc"]] })),
      ),
    ).toEqual(["sends the device header X-Device-Id"]);
  });

  it("flags a Cookie header on a request to our server", () => {
    expect(
      problems(
        har(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["Cookie", "session=abc"]] })),
      ),
    ).toEqual(["sends a Cookie header"]);
  });

  it("flags a Cookie header regardless of how it's cased", () => {
    expect(
      problems(har(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["cookie", "a=b"]] }))),
    ).toEqual(["sends a Cookie header"]);
  });

  it("flags a private value sent anywhere, even to another host", () => {
    expect(problems(har(entry("GET", "https://example.com/?d=2011-04-17")))).toEqual([
      'contains the private value "2011-04-17"',
    ]);
  });

  it("flags the sobriety date in written form, not just ISO", () => {
    expect(
      problems(har(entry("GET", "https://example.com/", { headers: [["x-note", "Apr 17, 2011"]] }))),
    ).toEqual(['contains the private value "Apr 17, 2011"']);
  });

  it("flags any other request to our server (5a makes no writes)", () => {
    expect(problems(har(entry("POST", `https://${SERVER}/api/v1/tags`, { body: "{}" })))).toEqual([
      "isn't one of the app's read requests",
    ]);
  });

  it("matches the server host without regard to case", () => {
    const report = auditHar(har(entry("GET", `https://${SERVER}/api/v1/vocabulary`)), {
      ...OPTIONS,
      server: "MyMeetingApp.Vercel.App",
    });
    expect(report).toEqual({ serverRequests: 1, otherHosts: [], findings: [] });
  });

  it("doesn't count a lookalike host as the server, even as a prefix", () => {
    const report = auditHar(har(entry("GET", `https://not${SERVER}/api/v1/vocabulary`)), OPTIONS);
    expect(report.serverRequests).toBe(0);
    expect(report.otherHosts).toEqual([`not${SERVER}`]);
  });

  it("doesn't count a lookalike host as the server, even as a suffix-matching subdomain trick", () => {
    const report = auditHar(har(entry("GET", `https://${SERVER}.evil.example/api/v1/vocabulary`)), OPTIONS);
    expect(report.serverRequests).toBe(0);
    expect(report.otherHosts).toEqual([`${SERVER}.evil.example`]);
  });
});
