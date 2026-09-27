import { format } from "node:util";

import { AppConfigResponse } from "@mymeetingapp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/v1/config/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const CONFIG_VARS = [
  "MIN_VERSION_IOS",
  "MIN_VERSION_ANDROID",
  "LATEST_VERSION_IOS",
  "LATEST_VERSION_ANDROID",
  "FEATURE_TAGGING",
  "FEATURE_SUGGESTIONS",
] as const;

function stubConfig(values: Partial<Record<(typeof CONFIG_VARS)[number], string>>) {
  for (const name of CONFIG_VARS) vi.stubEnv(name, values[name]);
}

async function getConfig() {
  const res = await GET(new Request("http://test/api/v1/config"));
  return { res, body: AppConfigResponse.parse(await res.json()) };
}

function warnings(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((args) => format(...args)).join("\n");
}

describe("GET /api/v1/config", () => {
  it("never forces an upgrade and turns every feature on when nothing is configured", async () => {
    stubConfig({});
    const { res, body } = await getConfig();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      minSupportedVersion: { ios: "0.0.0", android: "0.0.0" },
      latestVersion: { ios: "0.0.0", android: "0.0.0" },
      features: { tagging: true, suggestions: true },
    });
  });

  it("is cached briefly so a forced upgrade takes effect within minutes", async () => {
    stubConfig({});
    const { res } = await getConfig();
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
  });

  it("reports the configured versions and switches", async () => {
    stubConfig({
      MIN_VERSION_IOS: "1.2.0",
      MIN_VERSION_ANDROID: "1.1.0",
      LATEST_VERSION_IOS: "1.4.0",
      LATEST_VERSION_ANDROID: "1.4.1",
      FEATURE_TAGGING: "off",
      FEATURE_SUGGESTIONS: "on",
    });
    const { body } = await getConfig();
    expect(body).toEqual({
      minSupportedVersion: { ios: "1.2.0", android: "1.1.0" },
      latestVersion: { ios: "1.4.0", android: "1.4.1" },
      features: { tagging: false, suggestions: true },
    });
  });

  it("falls back to 0.0.0 and warns when a version is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubConfig({ MIN_VERSION_IOS: "1.2" });
    const { body } = await getConfig();
    expect(body.minSupportedVersion.ios).toBe("0.0.0");
    expect(warnings(warn)).toContain("MIN_VERSION_IOS");
  });

  it("switches a feature off and warns when its switch is neither on nor off", async () => {
    // A mistyped "off" during an incident must still turn the feature off.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubConfig({ FEATURE_TAGGING: "of" });
    const { body } = await getConfig();
    expect(body.features.tagging).toBe(false);
    expect(warnings(warn)).toContain("FEATURE_TAGGING");
  });

  it("accepts switches in any letter case", async () => {
    stubConfig({ FEATURE_SUGGESTIONS: "OFF" });
    const { body } = await getConfig();
    expect(body.features.suggestions).toBe(false);
  });
});
