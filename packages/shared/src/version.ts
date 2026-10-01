import { z } from "zod";

export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, "Expected a version like 1.2.3");

// True when `version` is below `minimum` (both like 1.2.3). The server refuses writes from such an app
// (upgrade_required), and the app shows its upgrade screen instead of searching.
export function isOlderVersion(version: string, minimum: string): boolean {
  const [a, b] = [version.split(".").map(Number), minimum.split(".").map(Number)];
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}
