import { describe, expect, it } from "vitest";

import { auditHar } from "../src/audit";
import type { Har } from "../src/har";

const SERVER = "mymeetings.app";
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
    // name, value, fileName?, contentType? — a HAR param can be a plain field or a multipart file field.
    params?: [string, string | undefined, string?, string?][];
    bodySize?: number;
    cookies?: [string, string][];
  } = {},
) {
  const hasBody = extra.body !== undefined || extra.params !== undefined || extra.encoding !== undefined;
  return {
    request: {
      method,
      url,
      headers: (extra.headers ?? []).map(([name, value]) => ({ name, value })),
      ...(extra.bodySize !== undefined ? { bodySize: extra.bodySize } : {}),
      ...(extra.cookies !== undefined
        ? { cookies: extra.cookies.map(([name, value]) => ({ name, value })) }
        : {}),
      ...(hasBody
        ? {
            postData: {
              ...(extra.body !== undefined ? { text: extra.body } : {}),
              ...(extra.encoding !== undefined ? { encoding: extra.encoding } : {}),
              ...(extra.params !== undefined
                ? {
                    params: extra.params.map(([name, value, fileName, contentType]) => ({
                      name,
                      value,
                      ...(fileName !== undefined ? { fileName } : {}),
                      ...(contentType !== undefined ? { contentType } : {}),
                    })),
                  }
                : {}),
            },
          }
        : {}),
    },
  };
}

// A HAR entry's mitmproxy-only extension carrying websocket frames, sibling to "request".
function entryWithWebSocket(base: ReturnType<typeof entry>, messages: string[]) {
  return { ...base, _webSocketMessages: messages.map((data) => ({ data })) };
}

// A HAR entry's response headers (etag, last-modified, ...), sibling to "request" — needed for an earlier
// entry to the same URL to make a later if-none-match/if-modified-since legitimate.
function entryWithResponse(base: ReturnType<typeof entry>, headers: [string, string][]) {
  return { ...base, response: { headers: headers.map(([name, value]) => ({ name, value })) } };
}

const har = (
  ...entries: (
    ReturnType<typeof entry> | ReturnType<typeof entryWithWebSocket> | ReturnType<typeof entryWithResponse>
  )[]
): Har => ({
  log: { entries },
});
const search = (body: string) => entry("POST", `https://${SERVER}/api/v1/meetings/search`, { body });
// A clean, valid search: appended to a fixture that's testing something else, so "the capture never
// exercised a search" doesn't drown out the finding under test.
const VALID_SEARCH = search('{"lat":36.16,"lng":-86.78,"radiusKm":25}');
const problems = (capture: Har) => auditHar(capture, OPTIONS).findings.map((finding) => finding.problem);
// A real UUID shape, reused as both a meeting id and a tags/:id path segment.
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

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
    expect(report).toEqual({
      serverRequests: 5,
      otherHosts: ["gsp-ssl.ls.apple.com"],
      findings: [],
      lookAt: [],
      userAgents: [],
      writeRequests: 0,
    });
  });

  it("flags coordinates in a URL on the search endpoint", () => {
    expect(
      problems(
        har(entry("POST", `https://${SERVER}/api/v1/meetings/search?lat=36.16&lng=-86.78`, { body: "{}" })),
      ),
    ).toContain("isn't one of the app's requests");
  });

  it("flags coordinates added to the query string of an otherwise-valid read", () => {
    expect(problems(har(entry("GET", `https://${SERVER}/api/v1/vocabulary?lat=36.16&lng=-86.78`)))).toContain(
      "isn't one of the app's requests",
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

  it("flags a request to a path the app never uses (not a read, the search, or one of the writes)", () => {
    expect(
      problems(har(entry("POST", `https://${SERVER}/api/v1/attest/unknown`, { body: "{}" }), VALID_SEARCH)),
    ).toEqual(["isn't one of the app's requests"]);
  });

  it("matches the server host without regard to case", () => {
    const report = auditHar(har(entry("GET", `https://${SERVER}/api/v1/vocabulary`), VALID_SEARCH), {
      ...OPTIONS,
      server: "MyMeetings.App",
    });
    expect(report).toEqual({
      serverRequests: 2,
      otherHosts: [],
      findings: [],
      lookAt: [],
      userAgents: [],
      writeRequests: 0,
    });
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
        lookAt: [],
        userAgents: [],
        writeRequests: 0,
      });
    });

    it("A2: flags a capture that only reaches a different host than --server", () => {
      // A local dev capture (192.168.1.5:3000) accidentally checked against the production --server: since
      // it never reaches mymeetings.app, this must not pass just because nothing else looks wrong.
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

    it("B4: flags an invisible body on a GET read, in the shape mitmdump actually writes (bodySize, no postData)", () => {
      // mitmdump's savehar.py only ever writes postData for POST/PUT/PATCH, but always writes bodySize — so a
      // GET carrying a body shows up as bodySize > 0 with no postData at all, never as postData on a GET.
      const found = problems(
        har(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { bodySize: 42 }), VALID_SEARCH),
      );
      expect(found).toContain("sends a body on a GET request");
      expect(found).toContain("body not recorded, can't be scanned");
    });

    it("B5: requires the meeting-detail id to actually be UUID-shaped", () => {
      // 36 characters of hex digits and hyphens, same character class the old regex accepted, but not
      // grouped like a UUID.
      const notAUuid = "-".repeat(36);
      expect(
        problems(har(entry("GET", `https://${SERVER}/api/v1/meetings/${notAUuid}`), VALID_SEARCH)),
      ).toContain("isn't one of the app's requests");
    });

    it("requires the meeting-detail id to be lowercase: the server's UUIDs (Postgres gen_random_uuid()) never are", () => {
      const upper = ID.toUpperCase();
      expect(
        problems(har(entry("GET", `https://${SERVER}/api/v1/meetings/${upper}`), VALID_SEARCH)),
      ).toContain("isn't one of the app's requests");
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

  describe("Fix round 2: adversarial cases", () => {
    // I1: allowed headers' values are pinned, not just their names. Pseudo-headers are no longer allowed at
    // all — mitmdump's HAR writer never records them, so one appearing is itself suspicious.
    it("N3: flags a coordinate hidden in the user-agent value", () => {
      expect(
        problems(
          har(
            entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["user-agent", "35.96,-83.92"]] }),
            VALID_SEARCH,
          ),
        ),
      ).toContain("sends an unexpected value for the user-agent header");
    });

    it("N4: flags a content-type value with smuggled extra data", () => {
      expect(
        problems(
          har(
            entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
              headers: [["content-type", "application/json; lat=36.16"]],
              body: '{"lat":36.16,"lng":-86.78,"radiusKm":25}',
            }),
          ),
        ),
      ).toContain("sends an unexpected value for the content-type header");
    });

    it("N5: flags the :method HTTP/2 pseudo-header", () => {
      expect(
        problems(
          har(
            entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [[":method", "GET"]] }),
            VALID_SEARCH,
          ),
        ),
      ).toContain("sends an unexpected header :method");
    });

    it("N6: flags the :scheme HTTP/2 pseudo-header", () => {
      expect(
        problems(
          har(
            entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [[":scheme", "https"]] }),
            VALID_SEARCH,
          ),
        ),
      ).toContain("sends an unexpected header :scheme");
    });

    it.each([
      ["host", SERVER],
      ["accept", "application/json"],
      ["accept-encoding", "gzip, deflate, br"],
      ["accept-language", "en-US,en;q=0.9"],
      ["user-agent", "mymeetingapp/1 CFNetwork/1408.0.4 Darwin/22.5.0"],
      ["user-agent", "okhttp/4.12.0"],
      ["priority", "u=3, i"],
      ["connection", "keep-alive"],
      // if-none-match/if-modified-since need a matching earlier response to be legitimate — covered by their
      // own tests below, not this generic list.
    ])("passes a clean %s header value on a read", (name, value) => {
      expect(
        problems(
          har(
            entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [[name, value]] }),
            VALID_SEARCH,
          ),
        ),
      ).toEqual([]);
    });

    it.each([
      ["content-type", "application/json"],
      ["cache-control", "no-cache"],
      ["pragma", "no-cache"],
    ])("passes a clean %s header value on the search POST", (name, value) => {
      const body = '{"lat":36.16,"lng":-86.78,"radiusKm":25}';
      expect(
        problems(
          har(
            entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
              headers: [[name, value]],
              body,
              bodySize: body.length,
            }),
          ),
        ),
      ).toEqual([]);
    });

    it("passes a clean content-length header value that matches the recorded bodySize", () => {
      const body = '{"lat":36.16,"lng":-86.78,"radiusKm":25}';
      expect(
        problems(
          har(
            entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
              headers: [["content-length", String(body.length)]],
              body,
              bodySize: body.length,
            }),
          ),
        ),
      ).toEqual([]);
    });

    // I2: the search body must match the app's real output byte-for-byte, not just parse to valid values.
    it("N1: flags a search body with a duplicate lat key, even though JSON.parse collapses it", () => {
      const found = problems(
        har(
          entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
            body: '{"lat":36.16,"lat":36.16,"lng":-86.78,"radiusKm":25}',
          }),
        ),
      );
      expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
    });

    it("N2: flags a search body whose lat has absurd precision that still parses to a rounded double", () => {
      const found = problems(
        har(
          entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
            body: '{"lat":36.160000000000000000036162749,"lng":-86.78,"radiusKm":25}',
          }),
        ),
      );
      expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
    });

    // I3: host matching can't be dodged with a trailing dot, or a scheme/port --server didn't declare.
    it("N7: a trailing dot on our own host doesn't let a Cookie header slip into otherHosts", () => {
      const report = auditHar(
        har(
          entry("GET", `https://${SERVER}./api/v1/vocabulary`, { headers: [["Cookie", "a=b"]] }),
          VALID_SEARCH,
        ),
        OPTIONS,
      );
      expect(report.otherHosts).toEqual([]);
      expect(report.findings.map((f) => f.problem)).toContain("sends a Cookie header");
    });

    it("N8: our hostname reached over plain http on port 443 is flagged, not filed under otherHosts", () => {
      const report = auditHar(
        har(
          entry("GET", `http://${SERVER}:443/api/v1/vocabulary`, { headers: [["Cookie", "a=b"]] }),
          VALID_SEARCH,
        ),
        OPTIONS,
      );
      expect(report.otherHosts).toEqual([]);
      expect(report.serverRequests).toBe(1);
      expect(report.findings.map((f) => f.problem)).toContain("our server reached a different way");
    });

    // I4: headers real phones actually send must not false-FAIL.
    it("R1: an iOS 17 GET with a priority header passes clean", () => {
      const report = auditHar(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, {
            headers: [
              ["accept", "application/json"],
              ["accept-encoding", "gzip, deflate, br"],
              ["accept-language", "en-US,en;q=0.9"],
              ["user-agent", "mymeetingapp/1 CFNetwork/1408.0.4 Darwin/22.5.0"],
              ["priority", "u=3, i"],
              ["connection", "keep-alive"],
              ["host", SERVER],
            ],
          }),
          VALID_SEARCH,
        ),
        OPTIONS,
      );
      expect(report.findings).toEqual([]);
    });

    it("R2: an if-none-match ETag echoing an earlier response in the same capture passes clean", () => {
      const url = `https://${SERVER}/api/v1/vocabulary`;
      const etag = '"33a64df551425fcc55e4d42a148795d9f25f89d"';
      const report = auditHar(
        har(
          entryWithResponse(entry("GET", url), [["etag", etag]]),
          entry("GET", url, { headers: [["if-none-match", etag]] }),
          VALID_SEARCH,
        ),
        OPTIONS,
      );
      expect(report.findings).toEqual([]);
    });

    it("R3: an Android okhttp GET stays clean", () => {
      const report = auditHar(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, {
            headers: [
              ["accept", "application/json"],
              ["accept-encoding", "gzip"],
              ["user-agent", "okhttp/4.12.0"],
              ["connection", "keep-alive"],
            ],
          }),
          VALID_SEARCH,
        ),
        OPTIONS,
      );
      expect(report.findings).toEqual([]);
    });

    // I5: mitmdump never writes postData for a GET, but always writes bodySize.
    it("N23: flags an unrecorded body sent to any host, not just ours", () => {
      expect(
        problems(har(entry("GET", "https://example.com/beacon", { bodySize: 10 }), VALID_SEARCH)),
      ).toContain("body not recorded, can't be scanned");
    });

    // M1: a percent-encoded run decodes as UTF-8, not one byte at a time.
    it("N17: decodes a multi-byte UTF-8 percent-encoded canary (Jos%C3%A9)", () => {
      const options = { ...OPTIONS, privateValues: [...OPTIONS.privateValues, "José"] };
      const found = auditHar(
        har(entry("GET", `https://${SERVER}/api/v1/vocabulary?name=Jos%C3%A9`), VALID_SEARCH),
        options,
      ).findings.map((f) => f.problem);
      expect(found).toContain("contains a private value");
    });

    // M2: repeated percent-decoding, HTML entities, and the JSON round trip on the decoded view too.
    it("N9: finds a canary that's been percent-encoded twice", () => {
      const doubleEncoded = "Apr%252017%252C%25202011";
      const found = problems(
        har(entry("GET", `https://${SERVER}/api/v1/vocabulary?d=${doubleEncoded}`), VALID_SEARCH),
      );
      expect(found).toContain("contains a private value");
    });

    it("N10: finds a canary hidden behind numeric HTML entities", () => {
      const entityEncoded = "Apr&#32;17&#44;&#32;2011";
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["x-note", entityEncoded]] }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("contains a private value");
    });

    it("N18: finds a canary behind a JSON \\u escape inside a percent-encoded body", () => {
      const innerJson = JSON.stringify({ note: "Apr 17, 2011" }).replace(
        "Apr 17, 2011",
        "\\u0041pr 17, 2011",
      );
      const body = encodeURIComponent(innerJson);
      const found = problems(har(entry("POST", `https://${SERVER}/api/v1/meetings/search`, { body })));
      expect(found).toContain("contains a private value");
    });

    // M3: exact-point fragments also match with the dot stripped, and with a comma decimal separator.
    it("N11: flags an exact coordinate fragment with the dot stripped", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["x-loc", "36162,-86781"]] }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("contains an exact coordinate");
    });

    it("N13: flags an exact coordinate fragment written with a comma decimal separator", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["x-loc", "36,162 / -86,781"]] }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("contains an exact coordinate");
    });

    // R2: the dot-stripped digits collide with timestamps and ids in unrelated traffic, so off our server they're
    // only worth a look; the dotted and comma forms stay failures everywhere.
    it("R2: flags the dotted or comma exact-point fragment on another host", () => {
      for (const value of ["36.162", "86,781"]) {
        const report = auditHar(
          har(entry("GET", `https://maps.example.com/tile?q=${value}`), VALID_SEARCH),
          OPTIONS,
        );
        expect(report.findings.map((f) => f.problem)).toEqual(["contains an exact coordinate"]);
      }
    });

    it("R2: puts the dot-stripped fragment on another host under look-at, not findings", () => {
      const report = auditHar(
        har(entry("GET", "https://cdn.example.com/a?t=1736162000"), VALID_SEARCH),
        OPTIONS,
      );
      expect(report.findings).toEqual([]);
      expect(report.lookAt).toEqual([
        "GET cdn.example.com/a: has an exact coordinate's digits without the dot",
      ]);
    });

    // M4: request.cookies, HAR params' fileName/contentType, and _webSocketMessages are all scanned too.
    it("N19: flags a non-empty request.cookies entry on our server, even with no Cookie header", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, { cookies: [["session", "abc123"]] }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("sends a Cookie header");
    });

    it("N22: scans a HAR param's fileName and contentType, not just its value", () => {
      const found = problems(
        har(
          entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
            params: [["upload", undefined, "Apr 17, 2011.txt", "text/plain"]],
          }),
        ),
      );
      expect(found).toContain("contains a private value");
    });

    it("N24: scans _webSocketMessages payloads for canaries", () => {
      const withSocket = entryWithWebSocket(entry("GET", "https://example.com/socket"), [
        "hello",
        "note: Apr 17, 2011",
      ]);
      const found = auditHar({ log: { entries: [withSocket, VALID_SEARCH] } }, OPTIONS).findings.map(
        (f) => f.problem,
      );
      expect(found).toContain("contains a private value");
    });

    // M5: advisory-only notes that don't fail the run.
    it("flags a coordinate-looking pair sent to another host as advisory, not a finding", () => {
      const report = auditHar(
        har(entry("GET", "https://maps.example.com/tile?lat=35.9614&lng=-83.9217"), VALID_SEARCH),
        OPTIONS,
      );
      expect(report.findings).toEqual([]);
      expect(report.lookAt.some((note) => note.includes("coordinate pair"))).toBe(true);
    });

    it("flags plain http to a public host as advisory, not a finding", () => {
      const report = auditHar(har(entry("GET", "http://example.com/asset.png"), VALID_SEARCH), OPTIONS);
      expect(report.findings).toEqual([]);
      expect(report.lookAt.some((note) => note.includes("plain http"))).toBe(true);
    });

    it("doesn't flag plain http to a loopback/private host", () => {
      const report = auditHar(har(entry("GET", "http://192.168.1.5:3000/asset"), VALID_SEARCH), OPTIONS);
      expect(report.lookAt).toEqual([]);
    });
  });

  describe("Fix round 3: header values are pinned, and conditional headers must echo the server", () => {
    const IOS_UA = "mymeetingapp/1 CFNetwork/1408.0.4 Darwin/22.5.0";
    const ANDROID_UA = "okhttp/4.12.0";

    it("X1: flags a coordinate smuggled as the iOS app version", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/config`, {
            headers: [["user-agent", "mymeetingapp/35.9614 CFNetwork/1408.0.4 Darwin/22.5.0"]],
          }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("sends an unexpected value for the user-agent header");
    });

    it("X2: flags a coordinate smuggled as the Android okhttp version", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["user-agent", "okhttp/35.9614"]] }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("sends an unexpected value for the user-agent header");
    });

    it("X3: flags more than one distinct user-agent value across the capture, and reports both", () => {
      const report = auditHar(
        har(
          entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["user-agent", IOS_UA]] }),
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["user-agent", ANDROID_UA]] }),
          VALID_SEARCH,
        ),
        OPTIONS,
      );
      expect(report.findings.map((f) => f.problem)).toContain(
        "sends more than one distinct user-agent value",
      );
      expect(report.userAgents).toEqual([IOS_UA, ANDROID_UA]);
    });

    it("reports the single user-agent value seen, for a human to confirm", () => {
      const report = auditHar(
        har(
          entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["user-agent", IOS_UA]] }),
          VALID_SEARCH,
        ),
        OPTIONS,
      );
      expect(report.userAgents).toEqual([IOS_UA]);
    });

    it("X4: flags a coordinate fragment smuggled as a fake accept-language region subtag", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["accept-language", "en-86781"]] }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("sends an unexpected value for the accept-language header");
    });

    it("X7: flags a content-length that doesn't match the recorded bodySize", () => {
      const body = '{"lat":36.16,"lng":-86.78,"radiusKm":25}';
      const found = problems(
        har(
          entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
            headers: [["content-length", "999"]],
            body,
            bodySize: body.length,
          }),
        ),
      );
      expect(found).toContain("sends an unexpected value for the content-length header");
    });

    it("X8: flags content-length present on a bodyless read", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["content-length", "0"]] }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("sends an unexpected value for the content-length header");
    });

    it("X5: flags a coordinate-plus-id in if-none-match with no matching earlier etag", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, {
            headers: [["if-none-match", '"36.16-abc123"']],
          }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("sends an unexpected value for the if-none-match header");
    });

    it("X6: flags the sobriety date written as an HTTP-date in if-modified-since, with no matching earlier response", () => {
      const found = problems(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, {
            headers: [["if-modified-since", "Sun, 17 Apr 2011 00:00:00 GMT"]],
          }),
          VALID_SEARCH,
        ),
      );
      expect(found).toContain("sends an unexpected value for the if-modified-since header");
    });

    it("allows if-none-match when it echoes an etag an earlier response to the same URL returned", () => {
      const url = `https://${SERVER}/api/v1/vocabulary`;
      const firstRead = entryWithResponse(entry("GET", url), [["etag", '"abc123"']]);
      const repeatRead = entry("GET", url, { headers: [["if-none-match", '"abc123"']] });
      const report = auditHar(har(firstRead, repeatRead, VALID_SEARCH), OPTIONS);
      expect(report.findings).toEqual([]);
    });

    it("names the actual method in a non-GET body finding", () => {
      const found = problems(
        har(entry("PUT", `https://${SERVER}/api/v1/vocabulary`, { bodySize: 10 }), VALID_SEARCH),
      );
      expect(found).toContain("sends a body on a PUT request");
    });

    describe("two realistic captures pass clean (savehar.py shape)", () => {
      const READ_HEADERS: [string, string][] = [
        ["host", SERVER],
        ["accept", "application/json"],
        ["accept-encoding", "gzip, deflate, br"],
        ["accept-language", "en-US,en;q=0.9"],
        ["connection", "keep-alive"],
      ];
      const searchBody = '{"lat":36.16,"lng":-86.78,"radiusKm":25}';

      it("a realistic iOS capture", () => {
        const ua = IOS_UA;
        const withUa = (extra: [string, string][] = []): [string, string][] => [
          ...READ_HEADERS,
          ["user-agent", ua],
          ["priority", "u=3, i"],
          ...extra,
        ];
        const report = auditHar(
          har(
            entry("GET", `https://${SERVER}/api/v1/config`, { headers: withUa() }),
            entryWithResponse(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: withUa() }), [
              ["etag", '"vocab-etag-1"'],
            ]),
            entry("GET", `https://${SERVER}/api/v1/meetings/online?day=1`, { headers: withUa() }),
            entry("GET", `https://${SERVER}/api/v1/meetings/0f8fad5b-d9cb-469f-a165-70867728950e`, {
              headers: withUa(),
            }),
            entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
              headers: withUa([
                ["content-type", "application/json"],
                ["content-length", String(searchBody.length)],
              ]),
              body: searchBody,
              bodySize: searchBody.length,
            }),
            // The app returns to the foreground and re-reads vocabulary; the OS attaches the ETag it kept.
            entry("GET", `https://${SERVER}/api/v1/vocabulary`, {
              headers: withUa([["if-none-match", '"vocab-etag-1"']]),
            }),
          ),
          OPTIONS,
        );
        expect(report.findings).toEqual([]);
        expect(report.userAgents).toEqual([ua]);
      });

      it("a realistic Android capture", () => {
        const ua = ANDROID_UA;
        const withUa = (extra: [string, string][] = []): [string, string][] => [
          ...READ_HEADERS,
          ["user-agent", ua],
          ...extra,
        ];
        const report = auditHar(
          har(
            entry("GET", `https://${SERVER}/api/v1/config`, { headers: withUa() }),
            entryWithResponse(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: withUa() }), [
              ["last-modified", "Wed, 21 Oct 2015 07:28:00 GMT"],
            ]),
            entry("GET", `https://${SERVER}/api/v1/meetings/online?day=1`, { headers: withUa() }),
            entry("GET", `https://${SERVER}/api/v1/meetings/0f8fad5b-d9cb-469f-a165-70867728950e`, {
              headers: withUa(),
            }),
            entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
              headers: withUa([
                ["content-type", "application/json"],
                ["content-length", String(searchBody.length)],
              ]),
              body: searchBody,
              bodySize: searchBody.length,
            }),
            entry("GET", `https://${SERVER}/api/v1/vocabulary`, {
              headers: withUa([["if-modified-since", "Wed, 21 Oct 2015 07:28:00 GMT"]]),
            }),
          ),
          OPTIONS,
        );
        expect(report.findings).toEqual([]);
        expect(report.userAgents).toEqual([ua]);
      });
    });
  });

  describe("writes", () => {
    const PROOF = `appattest.v1.${"A".repeat(43)}=.1791201600000.omlzaWduYXR1cmU=`;
    const WRITE_HEADERS: [string, string][] = [
      ["X-Device-Id", "6F9619FF-8B86-D011-B42D-00C04FC964FF"],
      ["X-Platform", "ios"],
      ["X-App-Version", "0.1.0"],
      ["X-Attestation", PROOF],
    ];
    // The app check's own requests (challenge, register) carry the device headers but never a proof.
    const DEVICE_ONLY = WRITE_HEADERS.filter(([name]) => name !== "X-Attestation");
    const TAG_BODY = `{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":true}`;
    // problems(), above, always appends VALID_SEARCH; this is the same idea for a single write entry.
    const problemsWith = (write: ReturnType<typeof entry>) => problems(har(VALID_SEARCH, write));

    it("passes each of the app's writes with the device headers and exactly its contract's body", () => {
      const report = auditHar(
        har(
          VALID_SEARCH,
          entry("POST", `https://${SERVER}/api/v1/tags`, { headers: WRITE_HEADERS, body: TAG_BODY }),
          entry("PUT", `https://${SERVER}/api/v1/tags/${ID}`, {
            headers: WRITE_HEADERS,
            body: '{"tags":["quiet"]}',
          }),
          entry("DELETE", `https://${SERVER}/api/v1/tags/${ID}`, { headers: WRITE_HEADERS }),
          entry("POST", `https://${SERVER}/api/v1/tags/delete-mine`, { headers: WRITE_HEADERS }),
          // C8: mitmdump's savehar.py always writes postData for a POST, even a bodiless one — an empty
          // text, an empty params array, and bodySize 0 (it may also add Content-Length: 0 on a write).
          entry("POST", `https://${SERVER}/api/v1/tags/delete-mine`, {
            headers: [...WRITE_HEADERS, ["content-length", "0"]],
            body: "",
            params: [],
            bodySize: 0,
          }),
          entry("POST", `https://${SERVER}/api/v1/suggestions`, {
            headers: WRITE_HEADERS,
            body: '{"text":"Candlelight"}',
          }),
          entry("POST", `https://${SERVER}/api/v1/attest/challenge`, { headers: DEVICE_ONLY }),
          entry("POST", `https://${SERVER}/api/v1/attest/register`, {
            headers: DEVICE_ONLY,
            body: `{"keyId":"${"A".repeat(43)}=","attestation":"o2NmbXQ=","challenge":"${"c".repeat(43)}"}`,
          }),
        ),
        OPTIONS,
      );
      expect(report.findings).toEqual([]);
      expect(report.writeRequests).toBe(8);
    });

    it.each([
      ["an extra field", `{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":true,"lat":36.16}`],
      ["a coordinate for nearMeeting", `{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":36.16}`],
      ["a duplicate key", `{"meetingId":"${ID}","tags":["quiet"],"tags":["quiet"]}`],
      ["different spacing", `{ "meetingId":"${ID}","tags":["quiet"]}`],
    ])("fails a tag body with %s", (_what, body) => {
      expect(
        problemsWith(entry("POST", `https://${SERVER}/api/v1/tags`, { headers: WRITE_HEADERS, body })),
      ).toContain("write body isn't exactly what the app sends");
    });

    it.each([
      ["X-Device-Id", "x-device-id"],
      ["X-Platform", "x-platform"],
      ["X-App-Version", "x-app-version"],
      ["X-Attestation", "x-attestation"],
    ])("fails a write missing %s", (headerName, lower) => {
      const headers = WRITE_HEADERS.filter(([name]) => name !== headerName);
      expect(
        problemsWith(entry("POST", `https://${SERVER}/api/v1/tags`, { headers, body: TAG_BODY })),
      ).toContain(`write without the ${lower} header`);
    });

    it("still fails a device header on a read", () => {
      expect(
        problemsWith(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: WRITE_HEADERS })),
      ).toContain("sends the device header X-Device-Id");
    });

    it("fails a registration whose body isn't exactly what the app sends", () => {
      expect(
        problemsWith(
          entry("POST", `https://${SERVER}/api/v1/attest/register`, {
            headers: DEVICE_ONLY,
            body: `{"keyId":"${"A".repeat(43)}=","attestation":"o2NmbXQ=","challenge":"${"c".repeat(43)}","lat":36.16}`,
          }),
        ),
      ).toContain("write body isn't exactly what the app sends");
    });

    it("fails a challenge request that carries a body or a proof", () => {
      expect(
        problemsWith(
          entry("POST", `https://${SERVER}/api/v1/attest/challenge`, {
            headers: DEVICE_ONLY,
            body: '{"x":1}',
          }),
        ),
      ).toContain("sends a body on a write that has none");
      expect(
        problemsWith(entry("POST", `https://${SERVER}/api/v1/attest/challenge`, { headers: WRITE_HEADERS })),
      ).toContain("sends X-Attestation on a request that never carries one");
    });

    it("fails a malformed device ID", () => {
      expect(
        problemsWith(
          entry("POST", `https://${SERVER}/api/v1/tags/delete-mine`, {
            headers: [["X-Device-Id", "36.162749"], ...WRITE_HEADERS.slice(1)],
          }),
        ),
      ).toContain("sends an unexpected value for the X-Device-Id header");
    });

    it("fails a body on a write that has none", () => {
      expect(
        problemsWith(
          entry("DELETE", `https://${SERVER}/api/v1/tags/${ID}`, {
            headers: WRITE_HEADERS,
            body: '{"x":1}',
          }),
        ),
      ).toContain("sends a body on a write that has none");
    });

    it("fails a capture holding two device IDs", () => {
      const other: [string, string][] = [["X-Device-Id", "dd96dec43fb81c97"], ...WRITE_HEADERS.slice(1)];
      const report = auditHar(
        har(
          VALID_SEARCH,
          entry("POST", `https://${SERVER}/api/v1/tags/delete-mine`, { headers: WRITE_HEADERS }),
          entry("POST", `https://${SERVER}/api/v1/tags/delete-mine`, { headers: other }),
        ),
        OPTIONS,
      );
      expect(report.findings).toContainEqual({
        request: "(capture)",
        problem: "sends more than one device ID",
      });
    });

    it("fails a write path or method the app never uses", () => {
      expect(
        problemsWith(
          entry("PUT", `https://${SERVER}/api/v1/tags`, { headers: WRITE_HEADERS, body: TAG_BODY }),
        ),
      ).toContain("isn't one of the app's requests");
    });

    it("fails a write to an uppercase meeting id: the server's UUIDs never are uppercase", () => {
      const upper = ID.toUpperCase();
      expect(
        problemsWith(
          entry("PUT", `https://${SERVER}/api/v1/tags/${upper}`, {
            headers: WRITE_HEADERS,
            body: '{"tags":["quiet"]}',
          }),
        ),
      ).toContain("isn't one of the app's requests");
    });
  });
});
