import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const EasJson = z.object({
  build: z.record(
    z.string(),
    z.looseObject({ env: z.record(z.string(), z.string()).optional(), pnpm: z.string().optional() }),
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

  // EAS installs this pnpm itself. With corepack enabled as well, its install collided with corepack's shim and the
  // build failed before it started.
  it("builds with the pnpm version the repo pins in packageManager", () => {
    const { packageManager } = RootPackage.parse(
      JSON.parse(readFileSync(path.join(__dirname, "../../../package.json"), "utf8")),
    );
    expect(`pnpm@${easJson().build.base?.pnpm ?? ""}`).toBe(packageManager.split("+")[0]);
  });
});
