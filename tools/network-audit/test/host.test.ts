import { describe, expect, it } from "vitest";

import { classifyHost, normalizeHost } from "../src/host";

describe("normalizeHost", () => {
  it("lowercases and strips a trailing dot", () => {
    expect(normalizeHost("MyMeetings.App.")).toBe("mymeetings.app");
  });
});

describe("classifyHost", () => {
  const SERVER = "mymeetings.app";

  it("recognizes our server", () => {
    expect(classifyHost(new URL(`https://${SERVER}/x`), SERVER)).toBe("server");
  });

  it("recognizes our server case-insensitively and past a trailing dot", () => {
    expect(classifyHost(new URL(`https://${SERVER}./x`), SERVER)).toBe("server");
    expect(classifyHost(new URL(`https://${SERVER.toUpperCase()}/x`), SERVER)).toBe("server");
  });

  it("treats an unrelated host as other", () => {
    expect(classifyHost(new URL("https://example.com/x"), SERVER)).toBe("other");
  });

  it("doesn't treat a lookalike prefix or suffix-matching subdomain as our server", () => {
    expect(classifyHost(new URL(`https://not${SERVER}/x`), SERVER)).toBe("other");
    expect(classifyHost(new URL(`https://${SERVER}.evil.example/x`), SERVER)).toBe("other");
  });

  it("flags our hostname reached over the wrong scheme as differentWay, not server or other", () => {
    expect(classifyHost(new URL(`http://${SERVER}:443/x`), SERVER)).toBe("differentWay");
  });

  it("flags our hostname reached on the wrong port as differentWay", () => {
    expect(classifyHost(new URL(`https://${SERVER}:8443/x`), SERVER)).toBe("differentWay");
  });

  it("treats an explicit matching local port as server, not differentWay", () => {
    const local = "192.168.1.5:3000";
    expect(classifyHost(new URL("http://192.168.1.5:3000/x"), local)).toBe("server");
  });

  it("treats a mismatched local port as differentWay", () => {
    const local = "192.168.1.5:3000";
    expect(classifyHost(new URL("http://192.168.1.5:4000/x"), local)).toBe("differentWay");
  });
});
