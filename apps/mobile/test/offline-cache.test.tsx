import { VocabularyResponse } from "@mymeetingapp/shared";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { fetchVocabulary } from "@/api/reads";
import { cachedRead } from "@/cache/cached-read";
import { isFresh } from "@/cache/freshness";
import { savedAtLabel } from "@/cache/saved-at";
import { readCache, writeCache } from "@/cache/store";
import { useCachedRead } from "@/cache/use-cached-read";
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
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: new Date(SAVED) });
    api = await startApi();
  });

  it("says plainly when there's no saved copy and the server can't be reached", async () => {
    await api.close();
    await expect(cachedRead(vocabularyRead)).rejects.toThrow("The server couldn't be reached");
    api = await startApi();
  });

  it("passes the server's refusal through even when a copy is saved", async () => {
    setNow(SAVED);
    await writeCache("vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 1).toISOString());
    api.reply(
      "/api/v1/vocabulary",
      { error: { code: "server_error", message: "Something went wrong on our end." } },
      500,
    );
    await expect(cachedRead(vocabularyRead)).rejects.toMatchObject({ code: "server_error" });
  });

  it("ignores a saved copy that no longer matches the contract", async () => {
    await writeCache("vocabulary", { tags: "not a list" });
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: null });
  });

  it("keeps only the latest search", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:36.16,-86.78,25"));
    await cachedRead(searchRead("search:35.96,-83.92,25"));
    expect(await readCache("search:36.16,-86.78,25")).toBeNull();
    expect(await readCache("search:35.96,-83.92,25")).not.toBeNull();
  });
});

describe("savedAtLabel", () => {
  it.each([
    ["2026-10-05T20:40:00.000Z", "2026-10-05T23:00:00.000Z", "today at 3:40 PM"],
    ["2026-10-04T05:05:00.000Z", "2026-10-05T23:00:00.000Z", "yesterday at 12:05 AM"],
    ["2026-09-27T17:00:00.000Z", "2026-10-05T23:00:00.000Z", "on Sep 27 at 12:00 PM"],
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
      {state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} />}
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
        "We couldn't reach mymeetingapp, and there's no saved copy on this phone yet. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });
});
