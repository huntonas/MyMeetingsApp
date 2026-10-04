import { describe, expect, it } from "vitest";

import { Har } from "../src/har";

function capture(postData: unknown) {
  return {
    log: {
      entries: [
        {
          request: {
            method: "POST",
            url: "https://mymeetings.app/api/v1/meetings/search",
            headers: [],
            postData,
          },
        },
      ],
    },
  };
}

describe("Har", () => {
  it("accepts postData with only text", () => {
    expect(Har.safeParse(capture({ text: "{}" })).success).toBe(true);
  });

  it("accepts postData with only params", () => {
    expect(Har.safeParse(capture({ params: [{ name: "a", value: "b" }] })).success).toBe(true);
  });

  it("accepts a base64-encoded body", () => {
    expect(Har.safeParse(capture({ text: "e30=", encoding: "base64" })).success).toBe(true);
  });

  it("rejects postData with neither text nor params", () => {
    expect(Har.safeParse(capture({ mimeType: "application/json" })).success).toBe(false);
  });

  it("rejects any encoding other than base64", () => {
    expect(Har.safeParse(capture({ text: "e30=", encoding: "gzip" })).success).toBe(false);
  });

  it("rejects an unknown postData field", () => {
    expect(Har.safeParse(capture({ text: "{}", bogus: true })).success).toBe(false);
  });

  it("accepts bodySize (mitmdump always writes it)", () => {
    const entry = {
      request: {
        method: "GET",
        url: "https://mymeetings.app/api/v1/vocabulary",
        headers: [],
        bodySize: 0,
      },
    };
    expect(Har.safeParse({ log: { entries: [entry] } }).success).toBe(true);
  });

  it("accepts request.cookies, ignoring the extra fields a real capture includes", () => {
    const entry = {
      request: {
        method: "GET",
        url: "https://mymeetings.app/api/v1/vocabulary",
        headers: [],
        cookies: [{ name: "a", value: "b", path: "/", expires: null, httpOnly: false, secure: true }],
      },
    };
    expect(Har.safeParse({ log: { entries: [entry] } }).success).toBe(true);
  });

  it("accepts a param's fileName and contentType", () => {
    expect(
      Har.safeParse(capture({ params: [{ name: "f", fileName: "a.txt", contentType: "text/plain" }] }))
        .success,
    ).toBe(true);
  });

  it("accepts _webSocketMessages on an entry", () => {
    const entry = {
      request: { method: "GET", url: "https://example.com/socket", headers: [] },
      _webSocketMessages: [{ type: "send", data: "hello", time: 1, fromClient: true }],
    };
    expect(Har.safeParse({ log: { entries: [entry] } }).success).toBe(true);
  });

  it("accepts response.headers, ignoring the extra fields a real capture includes", () => {
    const entry = {
      request: { method: "GET", url: "https://mymeetings.app/api/v1/vocabulary", headers: [] },
      response: {
        status: 200,
        statusText: "OK",
        headers: [{ name: "etag", value: '"abc123"' }],
        content: { size: 10, mimeType: "application/json" },
      },
    };
    expect(Har.safeParse({ log: { entries: [entry] } }).success).toBe(true);
  });

  it("accepts an entry with no response at all", () => {
    const entry = {
      request: { method: "GET", url: "https://mymeetings.app/api/v1/vocabulary", headers: [] },
    };
    expect(Har.safeParse({ log: { entries: [entry] } }).success).toBe(true);
  });
});
