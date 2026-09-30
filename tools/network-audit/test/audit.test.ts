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

function entry(
  method: string,
  url: string,
  extra: {
    headers?: [string, string][];
    body?: string;
    encoding?: "base64";
    params?: [string, string | undefined][];
  } = {},
) {
  const hasBody = extra.body !== undefined || extra.params !== undefined || extra.encoding !== undefined;
  return {
    request: {
      method,
      url,
      headers: (extra.headers ?? []).map(([name, value]) => ({ name, value })),
      ...(hasBody
        ? {
            postData: {
              ...(extra.body !== undefined ? { text: extra.body } : {}),
              ...(extra.encoding !== undefined ? { encoding: extra.encoding } : {}),
              ...(extra.params !== undefined
                ? { params: extra.params.map(([name, value]) => ({ name, value })) }
                : {}),
            },
          }
        : {}),
    },
  };
}

const har = (...entries: ReturnType<typeof entry>[]): Har => ({ log: { entries } });
const search = (body: string) => entry("POST", `https://${SERVER}/api/v1/meetings/search`, { body });
// A clean, valid search: appended to a fixture that's testing something else, so "the capture never
// exercised a search" doesn't drown out the finding under test.
const VALID_SEARCH = search('{"lat":36.16,"lng":-86.78,"radiusKm":25}');
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

  it("flags an unrounded point, and the exact coordinate in it (without repeating either)", () => {
    const found = problems(har(search('{"lat":36.162749,"lng":-86.78,"radiusKm":25}')));
    expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
    expect(found).toContain("contains an exact coordinate");
    // Never repeat the leaked point in the finding itself.
    expect(found.join(" ")).not.toContain("36.162749");
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
    expect(found).toContain("contains an exact coordinate");
  });

  it("flags a device header on a read", () => {
    expect(
      problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["X-Device-Id", "abc"]] }),
          VALID_SEARCH,
        ),
      ),
    ).toEqual(["sends the device header X-Device-Id"]);
  });

  it("flags a Cookie header on a request to our server", () => {
    expect(
      problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["Cookie", "session=abc"]] }),
          VALID_SEARCH,
        ),
      ),
    ).toEqual(["sends a Cookie header"]);
  });

  it("flags a Cookie header regardless of how it's cased", () => {
    expect(
      problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["cookie", "a=b"]] }),
          VALID_SEARCH,
        ),
      ),
    ).toEqual(["sends a Cookie header"]);
  });

  it("flags a private value sent anywhere, even to another host, without repeating it", () => {
    const found = problems(har(entry("GET", "https://example.com/?d=2011-04-17"), VALID_SEARCH));
    expect(found).toEqual(["contains a private value"]);
  });

  it("flags the sobriety date in written form, not just ISO", () => {
    const found = problems(
      har(entry("GET", "https://example.com/", { headers: [["x-note", "Apr 17, 2011"]] }), VALID_SEARCH),
    );
    expect(found).toEqual(["contains a private value"]);
  });

  it("flags any other request to our server (5a makes no writes)", () => {
    expect(
      problems(har(entry("POST", `https://${SERVER}/api/v1/tags`, { body: "{}" }), VALID_SEARCH)),
    ).toEqual(["isn't one of the app's read requests"]);
  });

  it("matches the server host without regard to case", () => {
    const report = auditHar(har(entry("GET", `https://${SERVER}/api/v1/vocabulary`), VALID_SEARCH), {
      ...OPTIONS,
      server: "MyMeetingApp.Vercel.App",
    });
    expect(report).toEqual({ serverRequests: 2, otherHosts: [], findings: [] });
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

  describe("Fix round 1: adversarial cases", () => {
    it("A1: flags an empty capture as never having exercised a search", () => {
      const report = auditHar({ log: { entries: [] } }, OPTIONS);
      expect(report).toEqual({
        serverRequests: 0,
        otherHosts: [],
        findings: [{ request: "(capture)", problem: "the capture never exercised a search" }],
      });
    });

    it("A2: flags a capture that only reaches a different host than --server", () => {
      // A local dev capture (192.168.1.5:3000) accidentally checked against the production --server: since
      // it never reaches mymeetingapp.vercel.app, this must not pass just because nothing else looks wrong.
      const report = auditHar(
        har(
          entry("POST", "http://192.168.1.5:3000/api/v1/meetings/search", {
            body: '{"lat":36.16,"lng":-86.78,"radiusKm":25}',
          }),
        ),
        OPTIONS,
      );
      expect(report.serverRequests).toBe(0);
      expect(report.otherHosts).toEqual(["192.168.1.5:3000"]);
      expect(report.findings).toEqual([
        { request: "(capture)", problem: "the capture never exercised a search" },
      ]);
    });

    it("B1: flags coordinates riding along in a header outside the allowlist (decimal)", () => {
      expect(
        problems(
          har(
            entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["x-loc", "35.96,-83.92"]] }),
            VALID_SEARCH,
          ),
        ),
      ).toContain("sends an unexpected header x-loc");
    });

    it("B2: flags coordinates riding along in a header outside the allowlist (microdegrees)", () => {
      expect(
        problems(
          har(
            entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["x-loc", "35960000,-83920000"]] }),
            VALID_SEARCH,
          ),
        ),
      ).toContain("sends an unexpected header x-loc");
    });

    it("B3: flags coordinates riding along in a header outside the allowlist (scientific notation)", () => {
      expect(
        problems(
          har(
            entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["x-loc", "3.596e1,-8.392e1"]] }),
            VALID_SEARCH,
          ),
        ),
      ).toContain("sends an unexpected header x-loc");
    });

    it("B4: flags a body on a GET read", () => {
      expect(
        problems(har(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { body: "{}" }), VALID_SEARCH)),
      ).toContain("sends a body on a GET request");
    });

    it("B5: requires the meeting-detail id to actually be UUID-shaped", () => {
      // 36 characters of hex digits and hyphens, same character class the old regex accepted, but not
      // grouped like a UUID.
      const notAUuid = "-".repeat(36);
      expect(
        problems(har(entry("GET", `https://${SERVER}/api/v1/meetings/${notAUuid}`), VALID_SEARCH)),
      ).toContain("isn't one of the app's read requests");
    });

    it("B6: flags an exact point sent to any host, not just ours", () => {
      expect(problems(har(entry("GET", "https://example.com/track?lat=36.162749"), VALID_SEARCH))).toContain(
        "contains an exact coordinate",
      );
    });

    it("C1: finds a canary percent-encoded in a form body", () => {
      expect(
        problems(
          har(entry("POST", `https://${SERVER}/api/v1/meetings/search`, { body: "d=Apr%2017%2C%202011" })),
        ),
      ).toContain("contains a private value");
    });

    it("C2: finds a canary behind a query string's +-for-space encoding", () => {
      expect(
        problems(har(entry("GET", `https://${SERVER}/api/v1/vocabulary?d=Apr+17%2C+2011`), VALID_SEARCH)),
      ).toContain("contains a private value");
    });

    it("C3: still finds a canary next to a malformed percent-escape", () => {
      expect(
        problems(
          har(entry("GET", `https://${SERVER}/api/v1/vocabulary?bad=%zz&d=Apr%2017%2C%202011`), VALID_SEARCH),
        ),
      ).toContain("contains a private value");
    });

    it("C5: decodes a base64 HAR body before scanning", () => {
      const encoded = Buffer.from("note=Apr 17, 2011", "utf8").toString("base64");
      expect(
        problems(
          har(
            entry("POST", `https://${SERVER}/api/v1/meetings/search`, { body: encoded, encoding: "base64" }),
          ),
        ),
      ).toContain("contains a private value");
    });

    it("C6: scans HAR params, not just postData.text", () => {
      expect(
        problems(
          har(
            entry("POST", `https://${SERVER}/api/v1/meetings/search`, { params: [["note", "Apr 17, 2011"]] }),
          ),
        ),
      ).toContain("contains a private value");
    });

    it("C7: finds a canary hidden behind a JSON \\uXXXX escape via a parse/stringify round trip", () => {
      const body = JSON.stringify({ lat: 36.16, lng: -86.78, radiusKm: 25, note: "Apr 17, 2011" }).replace(
        "Apr 17, 2011",
        "\\u0041pr 17, 2011",
      );
      expect(problems(har(entry("POST", `https://${SERVER}/api/v1/meetings/search`, { body })))).toContain(
        "contains a private value",
      );
    });

    it("C8: percent-decodes a canary hidden in a header value", () => {
      expect(
        problems(
          har(
            entry("GET", `https://${SERVER}/api/v1/vocabulary`, {
              headers: [["x-debug", "Apr%2017%2C%202011"]],
            }),
            VALID_SEARCH,
          ),
        ),
      ).toContain("contains a private value");
    });
  });
});
