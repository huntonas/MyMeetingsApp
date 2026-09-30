import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const EasJson = z.object({
  build: z.record(z.string(), z.looseObject({ env: z.record(z.string(), z.string()).optional() })),
});

describe("EAS build profiles", () => {
  it("points TestFlight builds at staging and store builds at production", () => {
    const { build } = EasJson.parse(JSON.parse(readFileSync(path.join(__dirname, "../eas.json"), "utf8")));
    expect(build.testflight?.env?.EXPO_PUBLIC_SERVER_URL).toBe("https://mymeetingapp-staging.vercel.app");
    expect(build.production?.env?.EXPO_PUBLIC_SERVER_URL).toBe("https://mymeetingapp.vercel.app");
  });
});
