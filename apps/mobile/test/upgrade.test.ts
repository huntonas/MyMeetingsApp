import type { AppConfigResponse } from "@mymeetingapp/shared";

import type { ReadState } from "@/cache/use-cached-read";
import { upgradeRequired } from "@/config/upgrade";

import { CONFIG } from "./fixtures";

const LOADING: ReadState<AppConfigResponse> = { status: "loading" };
const FAILED = (message: string): ReadState<AppConfigResponse> => ({ status: "failed", message });
const READY = (minimum: string): ReadState<AppConfigResponse> => ({
  status: "ready",
  savedAt: null,
  data: { ...CONFIG, minSupportedVersion: { ios: minimum, android: minimum } },
});

// Pins the gate's whole decision directly, independent of the read machinery and the native version fake:
// launch.test.tsx's integration tests only need to cover the read genuinely settling, not this table (review
// round 2).
describe("upgradeRequired", () => {
  it.each<[string, ReadState<AppConfigResponse>, string, boolean]>([
    ["loading", LOADING, "0.1.0", false],
    ["failed: unreachable, no saved copy", FAILED("The server couldn't be reached"), "0.1.0", false],
    [
      "failed: the server reported an error",
      FAILED("Something in that request wasn't right."),
      "0.1.0",
      false,
    ],
    ["ready: older than the minimum", READY("0.2.0"), "0.1.0", true],
    ["ready: equal to the minimum", READY("0.1.0"), "0.1.0", false],
    ["ready: newer than the minimum", READY("0.1.0"), "0.2.0", false],
    ["ready: an unparseable installed version", READY("0.2.0"), "1.0", false],
  ])("%s", (_name, state, installed, required) => {
    expect(upgradeRequired(state, installed)).toBe(required);
  });
});
