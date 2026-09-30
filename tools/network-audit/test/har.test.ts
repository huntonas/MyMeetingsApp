import { describe, expect, it } from "vitest";

import { Har } from "../src/har";

function capture(postData: unknown) {
  return {
    log: {
      entries: [
        {
          request: {
            method: "POST",
            url: "https://mymeetingapp.vercel.app/api/v1/meetings/search",
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
});
