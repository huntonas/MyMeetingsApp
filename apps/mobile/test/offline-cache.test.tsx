import { VocabularyResponse } from "@mymeetingapp/shared";
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { fetchVocabulary } from "@/api/reads";
import type { CachedRead } from "@/cache/cached-read";
import { cachedRead } from "@/cache/cached-read";
import { isFresh } from "@/cache/freshness";
import { savedAtLabel } from "@/cache/saved-at";
import { readCache, writeCache } from "@/cache/store";
import { useCachedRead } from "@/cache/use-cached-read";
import { appDatabase } from "@/db/database";
import { forgetRecentPlaces } from "@/location/recent-places";
import { SavedCopyNote } from "@/ui/saved-copy-note";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { VOCABULARY } from "./fixtures";

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
});
afterEach(async () => {
  await api.close();
});

const minutesAfter = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000);
const SAVED = "2026-10-05T20:40:00.000Z";

describe("isFresh: the app's reuse never outlasts the website's promises", () => {
  it.each([
    ["search", 74, true],
    ["search", 75, false],
    ["search", -1, false],
    ["meetingDetail", 59, true],
    ["meetingDetail", 60, false],
    ["onlineMeetings", 0.01, false],
    ["vocabulary", 0.01, false],
    ["config", 0.01, false],
  ] as const)("a %s copy %s minutes old is fresh: %s", (kind, minutes, fresh) => {
    expect(isFresh(kind, new Date(SAVED), minutesAfter(SAVED, minutes))).toBe(fresh);
  });
});

const vocabularyRead = {
  kind: "vocabulary",
  key: "vocabulary",
  schema: VocabularyResponse,
  fetch: fetchVocabulary,
} as const;
const searchRead = (key: string) =>
  ({ kind: "search", key, schema: VocabularyResponse, fetch: fetchVocabulary }) as const;

describe("cachedRead", () => {
  it("asks the server and saves the answer when nothing is saved", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: null });
    expect((await readCache("vocabulary"))?.body).toEqual(VOCABULARY);
  });

  it("reuses a copy inside its window without asking the server", async () => {
    setNow(SAVED);
    await writeCache("search:36.16,-86.78,25", VOCABULARY);
    setNow(minutesAfter(SAVED, 74).toISOString());
    expect(await cachedRead(searchRead("search:36.16,-86.78,25"))).toEqual({
      data: VOCABULARY,
      savedAt: null,
    });
    expect(api.requests).toHaveLength(0);
  });

  it("asks again once the window has passed", async () => {
    setNow(SAVED);
    await writeCache("search:36.16,-86.78,25", VOCABULARY);
    setNow(minutesAfter(SAVED, 75).toISOString());
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:36.16,-86.78,25"));
    expect(api.requests).toHaveLength(1);
  });

  it("shows a stale saved copy with its time when the server can't be reached", async () => {
    setNow(SAVED);
    await writeCache("vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 120).toISOString());
    await api.close();
    expect(await cachedRead(vocabularyRead)).toEqual({
      data: VOCABULARY,
      savedAt: new Date(SAVED),
      reason: "unreachable",
    });
    api = await startApi();
  });

  it("says plainly when there's no saved copy and the server can't be reached", async () => {
    await api.close();
    await expect(cachedRead(vocabularyRead)).rejects.toThrow("The server couldn't be reached");
    api = await startApi();
  });

  it.each(["server_error", "rate_limited"] as const)(
    "falls back to a saved copy when the server answers %s (owner ruling M2)",
    async (code) => {
      setNow(SAVED);
      await writeCache("vocabulary", VOCABULARY);
      setNow(minutesAfter(SAVED, 1).toISOString());
      api.reply("/api/v1/vocabulary", { error: { code, message: "message" } }, 500);
      expect(await cachedRead(vocabularyRead)).toEqual({
        data: VOCABULARY,
        savedAt: new Date(SAVED),
        reason: "serverError",
      });
    },
  );

  it("never falls back for a refusal specific to this request, even with a copy saved", async () => {
    setNow(SAVED);
    await writeCache("vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 1).toISOString());
    api.reply(
      "/api/v1/vocabulary",
      { error: { code: "meeting_not_found", message: "We couldn't find that meeting." } },
      404,
    );
    await expect(cachedRead(vocabularyRead)).rejects.toMatchObject({ code: "meeting_not_found" });
  });

  it("ignores a saved copy that no longer matches the contract", async () => {
    await writeCache("vocabulary", { tags: "not a list" });
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: null });
  });

  it("keeps only the latest search, leaving other cached kinds alone", async () => {
    await writeCache("vocabulary", VOCABULARY);
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:36.16,-86.78,25"));
    await cachedRead(searchRead("search:35.96,-83.92,25"));
    expect(await readCache("search:36.16,-86.78,25")).toBeNull();
    expect(await readCache("search:35.96,-83.92,25")).not.toBeNull();
    expect(await readCache("vocabulary")).not.toBeNull();
  });

  it("offline, answers a search with no copy of its own with the last search saved", async () => {
    setNow(SAVED);
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:36.16,-86.78,25"));
    setNow(minutesAfter(SAVED, 20).toISOString());
    await api.close();
    expect(await cachedRead(searchRead("search:35.96,-83.92,25"))).toEqual({
      data: VOCABULARY,
      savedAt: new Date(SAVED),
      reason: "unreachable",
    });
    api = await startApi();
  });

  it("never answers with another search's copy when the server itself answers with trouble", async () => {
    setNow(SAVED);
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:36.16,-86.78,25"));
    api.reply("/api/v1/vocabulary", { error: { code: "server_error", message: "message" } }, 500);
    await expect(cachedRead(searchRead("search:35.96,-83.92,25"))).rejects.toMatchObject({
      code: "server_error",
    });
  });

  it("never answers another kind of read with the last search's copy", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:36.16,-86.78,25"));
    await api.close();
    await expect(cachedRead(vocabularyRead)).rejects.toThrow("The server couldn't be reached");
    api = await startApi();
  });

  it("stamps the saved time from before the fetch starts, not from when it answers", async () => {
    setNow(SAVED);
    const slowRead = {
      kind: "vocabulary",
      key: "vocabulary",
      schema: VocabularyResponse,
      fetch: () => {
        // The request "takes a while": the clock moves on before it resolves.
        setNow(minutesAfter(SAVED, 5).toISOString());
        return Promise.resolve(VOCABULARY);
      },
    } as const;
    await cachedRead(slowRead);
    expect((await readCache("vocabulary"))?.savedAt).toEqual(new Date(SAVED));
  });
});

describe("cachedRead: two searches racing to save", () => {
  it("keeps the newer search result when an older request's fetch finishes later", async () => {
    setNow(SAVED);
    api.reply("/api/v1/vocabulary", VOCABULARY);
    const stalledKey = "search:1,1,25";
    const freshKey = "search:2,2,25";

    let releaseStalled: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseStalled = resolve;
    });
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const stalledRead = {
      kind: "search",
      key: stalledKey,
      schema: VocabularyResponse,
      fetch: async () => {
        markStarted();
        await blocked;
        return VOCABULARY;
      },
    } as const;

    // Starts first (captures the older fetchedAt) but doesn't resolve until released, below. Waiting for `started`
    // guarantees cachedRead has already captured its fetchedAt before the clock moves on.
    const stalledPromise = cachedRead(stalledRead);
    await started;
    setNow(minutesAfter(SAVED, 1).toISOString());
    // Starts later, but its request is a real one that answers immediately, so it saves first.
    await cachedRead(searchRead(freshKey));
    releaseStalled();
    await stalledPromise;

    expect(await readCache(freshKey)).not.toBeNull();
    expect(await readCache(stalledKey)).toBeNull();
  });
});

describe("cachedRead: a phone clock moved back", () => {
  it("still saves new searches after one was stamped in what is now the future", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 600).toISOString());
    await cachedRead(searchRead("search:1,1,25"));
    setNow(SAVED);
    await cachedRead(searchRead("search:2,2,25"));
    expect(await readCache("search:2,2,25")).not.toBeNull();
    expect(await readCache("search:1,1,25")).toBeNull();
  });
});

describe("cachedRead: a search still in flight during Clear recent places", () => {
  it("never saves a search that was asked for before Clear recent places", async () => {
    // This file's searchRead(key) is a "search"-kind read over the vocabulary path; answerLater plays a slow server.
    const answer = api.answerLater("/api/v1/vocabulary");
    const reading = cachedRead(searchRead("search:35.76,-83.97,25"));
    await waitFor(() => {
      expect(api.requests.some((r) => r.path === "/api/v1/vocabulary")).toBe(true);
    });
    await forgetRecentPlaces();
    answer(VOCABULARY);
    expect(await reading).toEqual({ data: VOCABULARY, savedAt: null });
    expect(await readCache("search:35.76,-83.97,25")).toBeNull();
  });

  it("still saves a search once the clock moves back past a forgotten-search stamp left in the future", async () => {
    // Stands in for a forgotten-search stamp written before the phone's clock was moved back: later than Date.now()
    // from here on, so it must never be treated as "forgot after this search started" (D3).
    const db = await appDatabase();
    await db.runAsync("insert or replace into settings (key, value) values (?, ?)", [
      "searches_forgotten_at",
      String(Date.now() + 600_000),
    ]);
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:35.76,-83.97,25"));
    expect(await readCache("search:35.76,-83.97,25")).not.toBeNull();
  });
});

describe("cachedRead treats its own cache as best effort", () => {
  it("still asks the server when the saved copy is corrupt", async () => {
    const db = await appDatabase();
    await db.runAsync("insert or replace into cache_entries (key, body, saved_at) values (?, ?, ?)", [
      "vocabulary",
      "not json",
      Date.now(),
    ]);
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: null });
  });

  it("still returns the freshly fetched data even when saving it fails", async () => {
    const db = await appDatabase();
    jest.spyOn(db, "runAsync").mockRejectedValueOnce(new Error("disk full"));
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: null });
  });
});

describe("savedAtLabel", () => {
  it.each([
    ["2026-10-05T20:40:00.000Z", "2026-10-05T23:00:00.000Z", "today at 3:40 PM"],
    ["2026-10-04T05:05:00.000Z", "2026-10-05T23:00:00.000Z", "yesterday at 12:05 AM"],
    ["2026-09-27T17:00:00.000Z", "2026-10-05T23:00:00.000Z", "on Sep 27 at 12:00 PM"],
    ["2025-09-27T17:00:00.000Z", "2026-10-05T23:00:00.000Z", "on Sep 27, 2025 at 12:00 PM"],
  ])("%s seen at %s reads %j", (saved, now, label) => {
    expect(savedAtLabel(new Date(saved), new Date(now))).toBe(label);
  });
});

function VocabularyCount() {
  const { state } = useCachedRead(vocabularyRead);
  if (state.status === "loading") return <Text>Loading</Text>;
  if (state.status === "failed") return <Text>{state.message}</Text>;
  return (
    <>
      {state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} reason={state.reason} />}
      <Text>{`${String(state.data.tags.length)} tags`}</Text>
    </>
  );
}

describe("useCachedRead with SavedCopyNote", () => {
  it("labels a saved copy shown because the server can't be reached", async () => {
    setNow(SAVED);
    await writeCache("vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 30).toISOString());
    await api.close();
    await render(<VocabularyCount />);
    expect(await screen.findByText("26 tags")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Showing the copy saved today at 3:40 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });

  it("says so when there's nothing saved and no connection", async () => {
    await api.close();
    await render(<VocabularyCount />);
    expect(
      await screen.findByText(
        "We couldn't reach mymeetingapp, and this isn't saved on your phone yet. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });

  it("labels a saved copy shown because the server had a problem, distinctly from unreachable (owner ruling M2)", async () => {
    setNow(SAVED);
    await writeCache("vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 30).toISOString());
    api.reply("/api/v1/vocabulary", { error: { code: "server_error", message: "message" } }, 500);
    await render(<VocabularyCount />);
    expect(await screen.findByText("26 tags")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Showing the copy saved today at 3:40 PM. mymeetingapp is having trouble right now, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
  });
});

function ThrowingVocabularyCount() {
  const { state } = useCachedRead({
    kind: "vocabulary",
    key: "vocabulary",
    schema: VocabularyResponse,
    fetch: () => Promise.reject(new Error("boom")),
  });
  if (state.status === "loading") return <Text>Loading</Text>;
  if (state.status === "failed") return <Text>{state.message}</Text>;
  return <Text>{`${String(state.data.tags.length)} tags`}</Text>;
}

describe("useCachedRead facing an error that isn't ApiError or Unreachable", () => {
  it("shows a generic message instead of staying on Loading forever", async () => {
    await render(<ThrowingVocabularyCount />);
    expect(await screen.findByText("Something went wrong on this phone. Try again.")).toBeOnTheScreen();
  });
});

function OptionalVocabularyCount({ read }: { read: CachedRead<typeof VocabularyResponse> | null }) {
  const { state } = useCachedRead(read);
  if (state.status === "loading") return <Text>Loading</Text>;
  if (state.status === "failed") return <Text>{state.message}</Text>;
  return <Text>{`${String(state.data.tags.length)} tags`}</Text>;
}

describe("useCachedRead when its read becomes null", () => {
  it("goes back to loading instead of leaving the previous read's result on screen", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    const { rerender } = await render(<OptionalVocabularyCount read={vocabularyRead} />);
    expect(await screen.findByText("26 tags")).toBeOnTheScreen();

    await rerender(<OptionalVocabularyCount read={null} />);
    expect(screen.getByText("Loading")).toBeOnTheScreen();
  });
});
