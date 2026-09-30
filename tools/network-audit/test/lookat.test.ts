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

  it("strips IPv6 brackets before matching (URL.hostname keeps them)", () => {
    expect(isPrivateOrLoopbackHost("[::1]")).toBe(true);
  });

  it("recognizes IPv6 loopback, unique-local and link-local ranges", () => {
    expect(isPrivateOrLoopbackHost("::1")).toBe(true);
    expect(isPrivateOrLoopbackHost("fd12:3456::1")).toBe(true);
    expect(isPrivateOrLoopbackHost("fe80::1")).toBe(true);
  });

  it("doesn't treat a public IPv6 address as private", () => {
    expect(isPrivateOrLoopbackHost("2001:db8::1")).toBe(false);
  });

  it("recognizes IPv4 link-local addresses (169.254.x.x)", () => {
    expect(isPrivateOrLoopbackHost("169.254.1.1")).toBe(true);
  });
});
