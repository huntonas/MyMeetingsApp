import { readFileSync } from "node:fs";
import path from "node:path";

import { OnlineMeetingsResponse } from "@mymeetingapp/shared";
import { describe, expect, it } from "vitest";

import PrivacyPage from "@/app/(site)/privacy/page";
import SupportPage from "@/app/(site)/support/page";
import { jsonResponse } from "@/lib/api/respond";
import { ADMIN_NOTICES } from "@/server/admin/notices";

import { renderText } from "./render";

// The timings the site and the admin notices promise, worked out from what actually sets them: the Cache-Control
// headers meeting responses are sent with, and the sync cron in vercel.ts. Changing either fails these tests until
// the promises match again.

function header(policy: "meetingDetail" | "onlineMeetings" | "vocabulary"): string {
  return jsonResponse(OnlineMeetingsResponse, { meetings: [] }, policy).headers.get("cache-control") ?? "";
}

function seconds(cacheControl: string, directive: string): number {
  const value = new RegExp(`${directive}=(\\d+)`).exec(cacheControl)?.[1];
  if (value === undefined) throw new Error(`no ${directive} in ${cacheControl}`);
  return Number(value);
}

// A CDN may serve a copy for s-maxage, then keep serving it stale for stale-while-revalidate while it refetches.
const appMinutes =
  Math.max(
    ...(["meetingDetail", "onlineMeetings"] as const).map((policy) => {
      const cacheControl = header(policy);
      return seconds(cacheControl, "s-maxage") + seconds(cacheControl, "stale-while-revalidate");
    }),
  ) / 60;

const vocabulary = header("vocabulary");
const vocabularyHours =
  (seconds(vocabulary, "s-maxage") + seconds(vocabulary, "stale-while-revalidate")) / 3600;

const vercelConfig = readFileSync(path.resolve(import.meta.dirname, "../vercel.ts"), "utf8");
const syncSchedule = /path: "\/api\/cron\/sync-feeds", schedule: "\*\/(\d+) \* \* \* \*"/.exec(
  vercelConfig,
)?.[1];
if (syncSchedule === undefined) throw new Error("vercel.ts has no every-n-minutes sync-feeds cron");
const feedMinutes = Number(syncSchedule) + appMinutes;

const FEED_SCOPE = "meetings that other lists also publish keep appearing from those lists";

describe("the opt-out timings the site promises", () => {
  const support = renderText(<SupportPage />);

  it("says a feed opt-out stops our use of that list only, and when the app catches up", () => {
    expect(support).toContain(`we stop using your list at the next sync; ${FEED_SCOPE}`);
    expect(support).toContain(`The app catches up within ${String(feedMinutes)} minutes.`);
  });

  it("says turning a group's tags off is immediate on our server, and when the app catches up", () => {
    expect(support).toContain(
      `That takes effect right away on our server; the app catches up within ${String(appMinutes)} minutes`,
    );
  });

  it("says tag counts change at once on our server after “Delete all my tags”, and when the app catches up", () => {
    expect(renderText(<PrivacyPage />)).toContain(
      `Tag counts update at once on our server; the app catches up within ${String(appMinutes)} minutes.`,
    );
  });
});

describe("the opt-out timings the admin notices promise", () => {
  it("says a feed opt-out keeps meetings other feeds publish, and when the app catches up", () => {
    expect(ADMIN_NOTICES.feed_opted_out).toContain(
      "meetings that other feeds also publish keep appearing from those feeds",
    );
    expect(ADMIN_NOTICES.feed_opted_out).toContain(
      `The app catches up within ${String(feedMinutes)} minutes.`,
    );
  });

  it("says turning tags off is immediate on our server, and when the app catches up", () => {
    expect(ADMIN_NOTICES.tags_turned_off).toContain(
      `right away on our server; the app catches up within ${String(appMinutes)} minutes`,
    );
  });
});

describe("the vocabulary timings the admin notices promise", () => {
  it.each(["approved", "tag_retired", "tag_restored"] as const)(
    "%s says when the app's cached tag list catches up",
    (notice) => {
      expect(ADMIN_NOTICES[notice]).toContain(`within ${String(vocabularyHours)} hours`);
    },
  );
});
