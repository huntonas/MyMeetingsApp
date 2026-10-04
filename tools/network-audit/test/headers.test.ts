import { describe, expect, it } from "vitest";

import { headerFinding } from "../src/headers";

const SERVER = "mymeetings.app";
const GET = { method: "GET", server: SERVER, write: false, attested: false };
const POST = { method: "POST", server: SERVER, write: false, attested: false };
// PUT never reads; every PUT the app sends (tag edit) is an attested write.
const PUT = { method: "PUT", server: SERVER, write: true, attested: true };
const IOS_UA = "mymeetingapp/1 CFNetwork/1408.0.4 Darwin/22.5.0";

describe("headerFinding", () => {
  it("flags any header starting with : — mitmdump never writes HTTP/2 pseudo-headers", () => {
    expect(headerFinding(":method", "GET", GET)).toBe("sends an unexpected header :method");
    expect(headerFinding(":scheme", "https", GET)).toBe("sends an unexpected header :scheme");
  });

  it("flags a Cookie header regardless of case", () => {
    expect(headerFinding("Cookie", "a=b", GET)).toBe("sends a Cookie header");
    expect(headerFinding("cookie", "a=b", GET)).toBe("sends a Cookie header");
  });

  it("flags a device header", () => {
    expect(headerFinding("X-Device-Id", "abc", GET)).toBe("sends the device header X-Device-Id");
  });

  it("flags a header name that isn't on the allowlist", () => {
    expect(headerFinding("x-loc", "35.96,-83.92", GET)).toBe("sends an unexpected header x-loc");
  });

  it("requires host to equal --server", () => {
    expect(headerFinding("host", SERVER, GET)).toBeUndefined();
    expect(headerFinding("host", "evil.example", GET)).toBe("sends an unexpected value for the host header");
  });

  it("allows a trailing dot on the host header", () => {
    expect(headerFinding("host", `${SERVER}.`, GET)).toBeUndefined();
  });

  it("requires accept to be exactly application/json", () => {
    expect(headerFinding("accept", "application/json", GET)).toBeUndefined();
    expect(headerFinding("accept", "*/*", GET)).toBe("sends an unexpected value for the accept header");
  });

  it("requires content-type to be application/json, sent only on a POST or PUT that carries a body", () => {
    expect(headerFinding("content-type", "application/json", { ...POST, bodySize: 41 })).toBeUndefined();
    expect(headerFinding("content-type", "application/json", { ...PUT, bodySize: 20 })).toBeUndefined();
    expect(headerFinding("content-type", "application/json", GET)).toBe(
      "sends an unexpected value for the content-type header",
    );
    expect(headerFinding("content-type", "application/json; lat=36.16", { ...POST, bodySize: 41 })).toBe(
      "sends an unexpected value for the content-type header",
    );
  });

  it("refuses content-type on a bodiless write", () => {
    expect(headerFinding("content-type", "application/json", { ...POST, write: true, bodySize: 0 })).toBe(
      "sends an unexpected value for the content-type header",
    );
  });

  describe("content-length must equal the request's real bodySize", () => {
    it("passes when it equals bodySize", () => {
      expect(headerFinding("content-length", "41", { ...POST, bodySize: 41 })).toBeUndefined();
    });

    it("X7: flags a value that doesn't match the recorded bodySize", () => {
      expect(headerFinding("content-length", "999", { ...POST, bodySize: 41 })).toBe(
        "sends an unexpected value for the content-length header",
      );
    });

    it("X8: flags content-length present when there's no body at all", () => {
      expect(headerFinding("content-length", "0", { ...GET, bodySize: 0 })).toBe(
        "sends an unexpected value for the content-length header",
      );
      expect(headerFinding("content-length", "41", GET)).toBe(
        "sends an unexpected value for the content-length header",
      );
    });

    it("allows content-length: 0 only on a bodiless write", () => {
      expect(headerFinding("content-length", "0", { ...POST, write: true, bodySize: 0 })).toBeUndefined();
      expect(headerFinding("content-length", "0", { ...GET, bodySize: 0 })).toBe(
        "sends an unexpected value for the content-length header",
      );
    });
  });

  it("requires cache-control and pragma to be no-cache", () => {
    expect(headerFinding("cache-control", "no-cache", GET)).toBeUndefined();
    expect(headerFinding("pragma", "no-cache", GET)).toBeUndefined();
    expect(headerFinding("cache-control", "no-cache, 35.96,-83.92", GET)).toBe(
      "sends an unexpected value for the cache-control header",
    );
  });

  describe("accept-language", () => {
    it("allows a real BCP47-lite value", () => {
      expect(headerFinding("accept-language", "en-US,en;q=0.9", GET)).toBeUndefined();
    });

    it("flags a coordinate fragment", () => {
      expect(headerFinding("accept-language", "35.96,-83.92", GET)).toBe(
        "sends an unexpected value for the accept-language header",
      );
    });

    it("X4: flags a coordinate fragment smuggled as a fake region subtag (the old loose regex allowed this)", () => {
      expect(headerFinding("accept-language", "en-86781", GET)).toBe(
        "sends an unexpected value for the accept-language header",
      );
    });

    it("flags more than 6 parts, even if each one is individually valid", () => {
      const sevenParts = Array.from({ length: 7 }, () => "en").join(",");
      expect(headerFinding("accept-language", sevenParts, GET)).toBe(
        "sends an unexpected value for the accept-language header",
      );
    });
  });

  describe("accept-encoding", () => {
    it("allows the real encoding tokens", () => {
      expect(headerFinding("accept-encoding", "gzip, deflate, br", GET)).toBeUndefined();
      expect(headerFinding("accept-encoding", "zstd", GET)).toBeUndefined();
      expect(headerFinding("accept-encoding", "identity", GET)).toBeUndefined();
    });

    it("flags a coordinate fragment", () => {
      expect(headerFinding("accept-encoding", "35.96,-83.92", GET)).toBe(
        "sends an unexpected value for the accept-encoding header",
      );
    });

    it("flags a token that isn't a real encoding (the old generic \\w-token regex allowed this)", () => {
      expect(headerFinding("accept-encoding", "x-custom-encoding", GET)).toBe(
        "sends an unexpected value for the accept-encoding header",
      );
    });
  });

  describe("user-agent", () => {
    it("allows the real iOS and Android shapes", () => {
      expect(headerFinding("user-agent", IOS_UA, GET)).toBeUndefined();
      expect(headerFinding("user-agent", "okhttp/4.12.0", GET)).toBeUndefined();
    });

    it("flags a coordinate pair outright", () => {
      expect(headerFinding("user-agent", "35.96,-83.92", GET)).toBe(
        "sends an unexpected value for the user-agent header",
      );
    });

    it("X1: flags a coordinate smuggled as the iOS app version (the old [\\w.]+ version regex allowed this)", () => {
      expect(headerFinding("user-agent", "mymeetingapp/35.9614 CFNetwork/1408.0.4 Darwin/22.5.0", GET)).toBe(
        "sends an unexpected value for the user-agent header",
      );
    });

    it("X2: flags a coordinate smuggled as the Android okhttp version (the old [\\d.]+ version regex allowed this)", () => {
      expect(headerFinding("user-agent", "okhttp/35.9614", GET)).toBe(
        "sends an unexpected value for the user-agent header",
      );
    });

    it("requires the app name to be exactly mymeetingapp", () => {
      expect(headerFinding("user-agent", "someotherapp/1 CFNetwork/1408.0.4 Darwin/22.5.0", GET)).toBe(
        "sends an unexpected value for the user-agent header",
      );
    });
  });

  it("requires priority to match RFC 9218", () => {
    expect(headerFinding("priority", "u=3, i", GET)).toBeUndefined();
    expect(headerFinding("priority", "u=9", GET)).toBe("sends an unexpected value for the priority header");
  });

  it("requires connection to be keep-alive or close", () => {
    expect(headerFinding("connection", "keep-alive", GET)).toBeUndefined();
    expect(headerFinding("connection", "close", GET)).toBeUndefined();
    expect(headerFinding("connection", "35.96,-83.92", GET)).toBe(
      "sends an unexpected value for the connection header",
    );
  });

  describe("conditional headers must echo an earlier response in this capture", () => {
    it("allows if-none-match only when it matches a known etag, on a GET", () => {
      expect(
        headerFinding("if-none-match", '"abc123"', { ...GET, knownEtags: new Set(['"abc123"']) }),
      ).toBeUndefined();
    });

    it("X5: flags an if-none-match value with no matching earlier etag, even one that looks like a coordinate plus an id", () => {
      expect(
        headerFinding("if-none-match", '"36.16-abc123"', { ...GET, knownEtags: new Set(['"other-etag"']) }),
      ).toBe("sends an unexpected value for the if-none-match header");
      expect(headerFinding("if-none-match", '"36.16-abc123"', GET)).toBe(
        "sends an unexpected value for the if-none-match header",
      );
    });

    it("allows if-modified-since only when it matches a known last-modified, on a GET", () => {
      const date = "Wed, 21 Oct 2015 07:28:00 GMT";
      expect(
        headerFinding("if-modified-since", date, { ...GET, knownLastModified: new Set([date]) }),
      ).toBeUndefined();
    });

    it("X6: flags an if-modified-since carrying the sobriety date as an HTTP-date, with no matching earlier response", () => {
      expect(headerFinding("if-modified-since", "Sun, 17 Apr 2011 00:00:00 GMT", GET)).toBe(
        "sends an unexpected value for the if-modified-since header",
      );
    });

    it("never allows either conditional header outside a GET, even with a matching value", () => {
      expect(headerFinding("if-none-match", '"abc123"', { ...POST, knownEtags: new Set(['"abc123"']) })).toBe(
        "sends an unexpected value for the if-none-match header",
      );
    });
  });

  describe("device headers on writes (spec §7)", () => {
    const WRITE = { method: "POST", server: SERVER, write: true, attested: true };

    it("passes a valid device id, platform and app version", () => {
      expect(headerFinding("X-Device-Id", "6F9619FF-8B86-D011-B42D-00C04FC964FF", WRITE)).toBeUndefined();
      expect(headerFinding("X-Platform", "ios", WRITE)).toBeUndefined();
      expect(headerFinding("X-App-Version", "0.1.0", WRITE)).toBeUndefined();
    });

    it("flags a device id that doesn't match the app's shape", () => {
      expect(headerFinding("X-Device-Id", "36.162749", WRITE)).toBe(
        "sends an unexpected value for the X-Device-Id header",
      );
    });

    it("flags a platform the app never sends", () => {
      expect(headerFinding("X-Platform", "web", WRITE)).toBe(
        "sends an unexpected value for the X-Platform header",
      );
    });

    it("flags an app version that isn't a SemVer", () => {
      expect(headerFinding("X-App-Version", "v1", WRITE)).toBe(
        "sends an unexpected value for the X-App-Version header",
      );
    });

    const PROOF = `appattest.v1.${"A".repeat(43)}=.1791201600000.omlzaWduYXR1cmU=`;

    it("passes an App Attest proof or a DeviceCheck token on a write that carries one", () => {
      expect(headerFinding("X-Attestation", PROOF, WRITE)).toBeUndefined();
      expect(headerFinding("X-Attestation", "devicecheck.v1.AgAAAAbcdef+/==", WRITE)).toBeUndefined();
    });

    it.each([
      ["a value that isn't a proof", "abc"],
      ["a coordinate where the clock goes", `appattest.v1.${"A".repeat(43)}=.36.162749.abc=`],
    ])("flags X-Attestation with %s", (_why, value) => {
      expect(headerFinding("X-Attestation", value, WRITE)).toBe(
        "sends an unexpected value for the X-Attestation header",
      );
    });

    it("flags X-Attestation on the app check's own requests, which never carry one", () => {
      expect(headerFinding("X-Attestation", PROOF, { ...WRITE, attested: false })).toBe(
        "sends X-Attestation on a request that never carries one",
      );
    });

    it("still flags a device header on a non-write, regardless of the value's shape", () => {
      expect(headerFinding("X-Device-Id", "6F9619FF-8B86-D011-B42D-00C04FC964FF", GET)).toBe(
        "sends the device header X-Device-Id",
      );
    });
  });
});
