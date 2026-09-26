import { z } from "zod";

import { SemVer } from "./version";

const PerPlatform = z.object({ ios: SemVer, android: SemVer });

export const AppConfigResponse = z.object({
  minSupportedVersion: PerPlatform,
  latestVersion: PerPlatform,
  features: z.object({ tagging: z.boolean(), suggestions: z.boolean() }),
});
export type AppConfigResponse = z.infer<typeof AppConfigResponse>;
