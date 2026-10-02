import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const EasJson = z.object({
  submit: z.record(
    z.string(),
    z.object({
      ios: z.object({ ascAppId: z.string(), appleTeamId: z.string(), metadataPath: z.string().optional() }),
    }),
  ),
  build: z.record(
    z.string(),
    z.looseObject({
      env: z.record(z.string(), z.string()).optional(),
      environment: z.string().optional(),
      pnpm: z.string().optional(),
    }),
  ),
});
const RootPackage = z.object({ packageManager: z.string() });

function easJson() {
  return EasJson.parse(JSON.parse(readFileSync(path.join(__dirname, "../eas.json"), "utf8")));
}

describe("EAS build profiles", () => {
  it("points TestFlight builds at staging and store builds at production", () => {
    const { build } = easJson();
    expect(build.testflight?.env?.EXPO_PUBLIC_SERVER_URL).toBe("https://mymeetingapp-staging.vercel.app");
    expect(build.production?.env?.EXPO_PUBLIC_SERVER_URL).toBe("https://mymeetingapp.vercel.app");
  });

  // Documentation, not protection: a dev build's JavaScript comes from Metro, which inlines the URL from the local
  // apps/mobile/.env, so this env reaches no bundle. serverUrl() is what keeps dev builds off production
  // (server-url.test.ts). development-simulator extends this profile.
  it("names staging for dev builds", () => {
    expect(easJson().build.development?.env?.EXPO_PUBLIC_SERVER_URL).toBe(
      "https://mymeetingapp-staging.vercel.app",
    );
  });

  // EAS environment variables (the Google Maps key among them) reach a build only from the environment its profile names.
  it("reads each profile's variables (the Google Maps key among them) from its own EAS environment", () => {
    const { build } = easJson();
    expect(build.development?.environment).toBe("development");
    expect(build.testflight?.environment).toBe("preview");
    expect(build.production?.environment).toBe("production");
  });

  // One app record and one team for both: TestFlight builds and the store build are builds of the same app
  // (finding: no transfer and no new record; owner decision 1). The team is the App ID prefix App Attest checks.
  it("submits TestFlight and store builds to the same App Store Connect app, on team PVCZBLDJ73", () => {
    const { submit } = easJson();
    expect(submit.testflight?.ios).toEqual({ ascAppId: "6817873804", appleTeamId: "PVCZBLDJ73" });
    expect(submit.production?.ios).toEqual({
      ascAppId: "6817873804",
      appleTeamId: "PVCZBLDJ73",
      metadataPath: "./store.config.json",
    });
  });

  // EAS installs this pnpm itself. With corepack enabled as well, its install collided with corepack's shim and the
  // build failed before it started.
  it("builds with the pnpm version the repo pins in packageManager", () => {
    const { packageManager } = RootPackage.parse(
      JSON.parse(readFileSync(path.join(__dirname, "../../../package.json"), "utf8")),
    );
    expect(`pnpm@${easJson().build.base?.pnpm ?? ""}`).toBe(packageManager.split("+")[0]);
  });
});
