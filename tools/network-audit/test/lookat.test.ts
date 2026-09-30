import { describe, expect, it } from "vitest";

import { isPrivateOrLoopbackHost, looksLikeCoordinatePair } from "../src/lookat";

describe("looksLikeCoordinatePair", () => {
  it("matches a comma-separated decimal pair", () => {
    expect(looksLikeCoordinatePair("lat=35.9614&lng=-83.9217")).toBe(true);
  });

  it("doesn't match a single decimal number", () => {
    expect(looksLikeCoordinatePair("version=1.25")).toBe(false);
  });
});

describe("isPrivateOrLoopbackHost", () => {
  it("recognizes loopback and private ranges", () => {
    expect(isPrivateOrLoopbackHost("localhost")).toBe(true);
    expect(isPrivateOrLoopbackHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("10.0.1.5")).toBe(true);
    expect(isPrivateOrLoopbackHost("192.168.1.5")).toBe(true);
    expect(isPrivateOrLoopbackHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("my-mac.local")).toBe(true);
  });

  it("doesn't treat a public host as private", () => {
    expect(isPrivateOrLoopbackHost("example.com")).toBe(false);
    expect(isPrivateOrLoopbackHost("172.32.0.1")).toBe(false);
  });
});
