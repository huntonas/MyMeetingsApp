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

const har = (...entries: (ReturnType<typeof entry> | ReturnType<typeof entryWithWebSocket>)[]): Har => ({
  log: { entries },
});
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
    expect(report).toEqual({
      serverRequests: 5,
      otherHosts: ["gsp-ssl.ls.apple.com"],
      findings: [],
      lookAt: [],
    });
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
    expect(report).toEqual({ serverRequests: 2, otherHosts: [], findings: [], lookAt: [] });
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
      ["user-agent", "MyMeetingApp/1 CFNetwork/1408.0.4 Darwin/22.5.0"],
      ["user-agent", "okhttp/4.12.0"],
      ["priority", "u=3, i"],
      ["connection", "keep-alive"],
      ["if-none-match", '"33a64df551425fcc55e4d42a148795d9f25f89d"'],
      ["if-modified-since", "Wed, 21 Oct 2015 07:28:00 GMT"],
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
      ["content-length", "41"],
      ["cache-control", "no-cache"],
      ["pragma", "no-cache"],
    ])("passes a clean %s header value on the search POST", (name, value) => {
      expect(
        problems(
          har(
            entry("POST", `https://${SERVER}/api/v1/meetings/search`, {
              headers: [[name, value]],
              body: '{"lat":36.16,"lng":-86.78,"radiusKm":25}',
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
              ["user-agent", "MyMeetingApp/1 CFNetwork/1408.0.4 Darwin/22.5.0"],
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

    it("R2: an if-none-match ETag on a GET read passes clean", () => {
      const report = auditHar(
        har(
          entry("GET", `https://${SERVER}/api/v1/vocabulary`, {
            headers: [["if-none-match", '"33a64df551425fcc55e4d42a148795d9f25f89d"']],
          }),
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
});
