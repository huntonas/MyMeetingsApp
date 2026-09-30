import { describe, expect, it } from "vitest";

import { headerFinding } from "../src/headers";

const SERVER = "mymeetingapp.vercel.app";
const GET = { method: "GET", server: SERVER };
const POST = { method: "POST", server: SERVER };

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

  it("requires content-type to be application/json and only on POST", () => {
    expect(headerFinding("content-type", "application/json", POST)).toBeUndefined();
    expect(headerFinding("content-type", "application/json", GET)).toBe(
      "sends an unexpected value for the content-type header",
    );
    expect(headerFinding("content-type", "application/json; lat=36.16", POST)).toBe(
      "sends an unexpected value for the content-type header",
    );
  });

  it("requires content-length to be digits", () => {
    expect(headerFinding("content-length", "41", POST)).toBeUndefined();
    expect(headerFinding("content-length", "41; lat=36.16", POST)).toBe(
      "sends an unexpected value for the content-length header",
    );
  });

  it("requires cache-control and pragma to be no-cache", () => {
    expect(headerFinding("cache-control", "no-cache", GET)).toBeUndefined();
    expect(headerFinding("pragma", "no-cache", GET)).toBeUndefined();
    expect(headerFinding("cache-control", "no-cache, 35.96,-83.92", GET)).toBe(
      "sends an unexpected value for the cache-control header",
    );
  });

  it("requires accept-language to be a comma list of language tags with optional ;q=", () => {
    expect(headerFinding("accept-language", "en-US,en;q=0.9", GET)).toBeUndefined();
    expect(headerFinding("accept-language", "35.96,-83.92", GET)).toBe(
      "sends an unexpected value for the accept-language header",
    );
  });

  it("requires accept-encoding to be a comma list of tokens", () => {
    expect(headerFinding("accept-encoding", "gzip, deflate, br", GET)).toBeUndefined();
    expect(headerFinding("accept-encoding", "35.96,-83.92", GET)).toBe(
      "sends an unexpected value for the accept-encoding header",
    );
  });

  it("requires user-agent to match the CFNetwork or okhttp shape", () => {
    expect(
      headerFinding("user-agent", "MyMeetingApp/1 CFNetwork/1408.0.4 Darwin/22.5.0", GET),
    ).toBeUndefined();
    expect(headerFinding("user-agent", "okhttp/4.12.0", GET)).toBeUndefined();
    expect(headerFinding("user-agent", "35.96,-83.92", GET)).toBe(
      "sends an unexpected value for the user-agent header",
    );
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

  it("allows if-none-match and if-modified-since on GET only", () => {
    expect(headerFinding("if-none-match", '"etag"', GET)).toBeUndefined();
    expect(headerFinding("if-modified-since", "Wed, 21 Oct 2015 07:28:00 GMT", GET)).toBeUndefined();
    expect(headerFinding("if-none-match", '"etag"', POST)).toBe(
      "sends an unexpected value for the if-none-match header",
    );
  });
});
