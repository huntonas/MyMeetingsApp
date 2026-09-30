import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { pruneCache } from "@/cache/prune";
import { readCache, writeCache } from "@/cache/store";
import { appDatabase } from "@/db/database";
import { favoriteIds, setFavorite } from "@/saved/favorites";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SURVIVOR = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PATH = `/api/v1/meetings/${ID}`;
const CARD = "Nooners, Mon 12:00 PM, St. Luke's, Welcoming 14 people";
const EMPTY = "Meetings you save appear here.";
const GONE = {
  error: {
    code: "meeting_not_found",
    message: "We couldn't find that meeting. It may have been removed from the meeting list.",
  },
};

let api: TestApi;

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
});
afterEach(async () => {
  await api.close();
});

// For a screen with no tag chips to wait on: the tag list, read at every launch, has landed (as in launch.test.tsx).
async function launchReadsLanded() {
  await waitFor(async () => {
    expect(await readCache("vocabulary")).not.toBeNull();
  });
}

// Fails only the statements starting with `sql`, as a full disk or a damaged table would; everything else runs.
async function failStatements(method: "runAsync" | "getAllAsync", sql: string) {
  const db = await appDatabase();
  if (method === "runAsync") {
    const real = db.runAsync.bind(db);
    return jest
      .spyOn(db, "runAsync")
      .mockImplementation((source, params) =>
        source.startsWith(sql) ? Promise.reject(new Error("disk full")) : real(source, params),
      );
  }
  const real = db.getAllAsync.bind(db);
  return jest
    .spyOn(db, "getAllAsync")
    .mockImplementation((source, params) =>
      source.startsWith(sql) ? Promise.reject(new Error("disk error")) : real(source, params),
    );
}

const meetingRequests = () =>
  api.requests.filter((r) => r.path.startsWith("/api/v1/meetings/")).map((r) => r.path);

describe("favoriteIds", () => {
  it("lists the newest saved first, and saving again doesn't move a meeting", async () => {
    setNow("2026-10-05T12:00:00Z");
    await setFavorite(ID, true);
    setNow("2026-10-05T13:00:00Z");
    await setFavorite(OTHER, true);
    setNow("2026-10-05T14:00:00Z");
    await setFavorite(ID, true);
    expect(await favoriteIds()).toEqual([OTHER, ID]);
  });

  it("lists the later of two saves in the same millisecond first", async () => {
    setNow("2026-10-05T12:00:00Z");
    await setFavorite(ID, true);
    await setFavorite(OTHER, true);
    expect(await favoriteIds()).toEqual([OTHER, ID]);
  });
});

describe("the Save heart on a meeting's page", () => {
  it("saves the meeting, which then shows on the Saved tab without asking the server again", async () => {
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    await fireEvent.press(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeOnTheScreen();
    expect(await favoriteIds()).toEqual([ID]);

    await cleanup();
    await renderApp("/saved");
    // The card's tag label means the tag list has loaded too, so launch's reads have landed.
    expect(await screen.findByRole("button", { name: CARD })).toBeOnTheScreen();
    expect(meetingRequests()).toEqual([PATH]);
  });

  it("unsaves a saved meeting", async () => {
    await setFavorite(ID, true);
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    await fireEvent.press(await screen.findByRole("button", { name: "Saved" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeOnTheScreen();
    expect(await favoriteIds()).toEqual([]);
  });

  it("stays saved when the page follows a merged meeting to its new id", async () => {
    await setFavorite(ID, true);
    api.reply(PATH, { meeting: meeting({ id: SURVIVOR }) });
    const app = await renderApp(`/meeting/${ID}`);
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
    });
    expect(await screen.findByRole("button", { name: "Saved" })).toBeOnTheScreen();
    expect(await favoriteIds()).toEqual([SURVIVOR]);
  });

  it("keeps the heart as it was when saving fails", async () => {
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByLabelText("Welcoming 14 people")).toBeOnTheScreen();
    const save = await failStatements("runAsync", "insert or ignore into favorites");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(expect.stringMatching(/^insert or ignore into favorites/), [
        ID,
        expect.any(Number),
      ]);
    });
    expect(await favoriteIds()).toEqual([]);
    expect(screen.getByRole("button", { name: "Save" })).toBeOnTheScreen();
  });

  it("shows no heart when the phone can't say whether the meeting is saved", async () => {
    const read = await failStatements("getAllAsync", "select meeting_id from favorites where");
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByLabelText("Welcoming 14 people")).toBeOnTheScreen();
    await waitFor(() => {
      expect(read).toHaveBeenCalledWith(expect.stringMatching(/^select meeting_id from favorites where/), [
        ID,
      ]);
    });
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});

describe("the Saved tab", () => {
  it("says how to save when nothing is saved", async () => {
    await renderApp("/saved");
    expect(await screen.findByText(EMPTY)).toBeOnTheScreen();
    expect(
      screen.getByText("Tap Save on a meeting's page. Saved meetings stay on this phone and work offline."),
    ).toBeOnTheScreen();
    await launchReadsLanded();
  });

  it("reads the list again each time the tab comes back into view", async () => {
    await renderApp("/saved");
    expect(await screen.findByText(EMPTY)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Me"));
    // As if saved on a meeting's page, opened from another tab.
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    await fireEvent.press(screen.getByLabelText("Saved"));
    expect(await screen.findByRole("button", { name: CARD })).toBeOnTheScreen();
  });

  it("lists each saved meeting with its day and time, newest saved first", async () => {
    setNow("2026-10-05T12:00:00Z");
    await setFavorite(ID, true);
    setNow("2026-10-05T12:01:00Z");
    await setFavorite(OTHER, true);
    api.reply(PATH, { meeting: meeting() });
    api.reply(`/api/v1/meetings/${OTHER}`, {
      meeting: meeting({ id: OTHER, name: "Early Birds", day: 2, time: "07:00" }),
    });
    await renderApp("/saved");
    expect(await screen.findByRole("button", { name: CARD })).toBeOnTheScreen();
    const earlyBirds = await screen.findByRole("button", {
      name: "Early Birds, Tue 7:00 AM, St. Luke's, Welcoming 14 people",
    });
    expect(screen.getAllByRole("button", { name: /Welcoming 14 people$/ })).toEqual([
      earlyBirds,
      screen.getByRole("button", { name: CARD }),
    ]);
  });

  it("works offline from the saved copy, and says so", async () => {
    setNow("2026-10-05T20:00:00Z");
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    setNow("2026-10-06T20:00:00Z");
    await api.close();
    await renderApp("/saved");
    expect(await screen.findByRole("button", { name: /^Nooners, Mon 12:00 PM/ })).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Showing the copy saved yesterday at 3:00 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });

  it("reuses copies still in their window, and asks again only for the others when the tab comes back", async () => {
    setNow("2026-10-05T12:00:00Z");
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    setNow("2026-10-05T12:30:00Z");
    await setFavorite(OTHER, true);
    await writeCache(`meeting:${OTHER}`, { meeting: meeting({ id: OTHER, name: "Early Birds" }) });
    setNow("2026-10-05T12:50:00Z");
    await renderApp("/saved");
    expect(await screen.findByRole("button", { name: CARD })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Early Birds/ })).toBeOnTheScreen();
    expect(meetingRequests()).toEqual([]);

    await fireEvent.press(screen.getByLabelText("Me"));
    // Nooners' copy is now 70 minutes old, past its 60-minute window; Early Birds' is 40.
    setNow("2026-10-05T13:10:00Z");
    api.reply(PATH, { meeting: meeting({ name: "Nooners (renamed)" }) });
    await fireEvent.press(await screen.findByLabelText("Saved"));
    expect(await screen.findByRole("button", { name: /^Nooners \(renamed\)/ })).toBeOnTheScreen();
    expect(meetingRequests()).toEqual([PATH]);
  });

  it("keeps a merged saved meeting saved under its new id", async () => {
    await setFavorite(ID, true);
    api.reply(PATH, { meeting: meeting({ id: SURVIVOR }) });
    await renderApp("/saved");
    expect(await screen.findByRole("button", { name: CARD })).toBeOnTheScreen();
    await waitFor(async () => {
      expect(await favoriteIds()).toEqual([SURVIVOR]);
    });
    // The moved copy is fresh, so the new id isn't asked for.
    expect(await screen.findByRole("button", { name: CARD })).toBeOnTheScreen();
    expect(meetingRequests()).toEqual([PATH]);
  });

  it("lists a merged meeting once, in the survivor's own place, when both its ids were saved", async () => {
    setNow("2026-10-05T12:00:00Z");
    await setFavorite(ID, true);
    setNow("2026-10-05T12:01:00Z");
    await setFavorite(OTHER, true);
    setNow("2026-10-05T12:02:00Z");
    await setFavorite(SURVIVOR, true);
    api.reply(PATH, { meeting: meeting({ id: SURVIVOR }) });
    api.reply(`/api/v1/meetings/${SURVIVOR}`, { meeting: meeting({ id: SURVIVOR }) });
    api.reply(`/api/v1/meetings/${OTHER}`, { meeting: meeting({ id: OTHER, name: "Early Birds" }) });
    await renderApp("/saved");
    await waitFor(async () => {
      expect(await favoriteIds()).toEqual([SURVIVOR, OTHER]);
    });
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: CARD })).toHaveLength(1);
    });
  });

  it("keeps a merged favorite under its old id when it can't be moved", async () => {
    const db = await appDatabase();
    const move = jest.spyOn(db, "withTransactionAsync").mockRejectedValueOnce(new Error("disk full"));
    await setFavorite(ID, true);
    api.reply(PATH, { meeting: meeting({ id: SURVIVOR }) });
    await renderApp("/saved");
    expect(await screen.findByRole("button", { name: CARD })).toBeOnTheScreen();
    await waitFor(() => {
      expect(move).toHaveBeenCalled();
    });
    expect(await favoriteIds()).toEqual([ID]);
    expect(screen.getByRole("button", { name: CARD })).toBeOnTheScreen();
  });

  it("names a saved meeting that's no longer listed, never showing its old copy, and lets it be removed", async () => {
    setNow("2026-10-05T12:00:00Z");
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    setNow("2026-10-06T12:00:00Z");
    api.reply(PATH, GONE, 404);
    await renderApp("/saved");
    expect(await screen.findByText("Nooners is no longer listed.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Nooners/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Remove Nooners" }));
    expect(await screen.findByText(EMPTY)).toBeOnTheScreen();
    expect(await favoriteIds()).toEqual([]);
  });

  it("says a saved meeting with no copy on the phone is no longer listed", async () => {
    await setFavorite(ID, true);
    api.reply(PATH, GONE, 404);
    await renderApp("/saved");
    expect(await screen.findByText("This meeting is no longer listed.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(EMPTY)).toBeOnTheScreen();
    await launchReadsLanded();
  });

  it("keeps a meeting that's no longer listed when it can't be removed", async () => {
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() }, new Date(Date.now() - 2 * 3_600_000));
    api.reply(PATH, GONE, 404);
    await renderApp("/saved");
    const remove = await failStatements("runAsync", "delete from favorites");
    await fireEvent.press(await screen.findByRole("button", { name: "Remove Nooners" }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith(expect.stringMatching(/^delete from favorites/), [ID]);
    });
    expect(await favoriteIds()).toEqual([ID]);
    expect(screen.getByText("Nooners is no longer listed.")).toBeOnTheScreen();
    await launchReadsLanded();
  });

  it("says so when the phone can't read what's saved", async () => {
    await failStatements("getAllAsync", "select meeting_id from favorites");
    await renderApp("/saved");
    expect(await screen.findByText("Something went wrong on this phone. Try again.")).toBeOnTheScreen();
    expect(screen.queryByText(EMPTY)).toBeNull();
    await launchReadsLanded();
  });
});

describe("pruneCache", () => {
  it("drops a meeting's copy after 30 days and an online list's after 7, but keeps saved meetings' and the rest", async () => {
    const OLD = "33333333-3333-4333-8333-333333333333";
    const RECENT = "44444444-4444-4444-8444-444444444444";
    const EXACTLY_30_DAYS = "55555555-5555-4555-8555-555555555555";
    setNow("2026-09-01T12:00:00Z");
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    await writeCache(`meeting:${OLD}`, { meeting: meeting({ id: OLD }) });
    await writeCache("vocabulary", VOCABULARY);
    await writeCache("search:36.16,-86.78,25", { meetings: [] });
    setNow("2026-09-06T12:00:00Z");
    await writeCache(
      `meeting:${EXACTLY_30_DAYS}`,
      { meeting: meeting({ id: EXACTLY_30_DAYS }) },
      new Date("2026-09-05T12:00:00Z"),
    );
    await writeCache(`meeting:${RECENT}`, { meeting: meeting({ id: RECENT }) });
    setNow("2026-09-27T12:00:00Z");
    await writeCache("online:1", { meetings: [] });
    await writeCache("online:3", { meetings: [] }, new Date("2026-09-28T12:00:00Z"));
    setNow("2026-09-29T12:00:00Z");
    await writeCache("online:2", { meetings: [] });
    // 34 days after the first copies; exactly 30 after EXACTLY_30_DAYS; 29 after RECENT; 8 after online:1; exactly 7
    // after online:3; 6 after online:2.
    setNow("2026-10-05T12:00:00Z");
    await pruneCache();
    expect(await readCache(`meeting:${ID}`)).not.toBeNull();
    expect(await readCache(`meeting:${OLD}`)).toBeNull();
    expect(await readCache(`meeting:${RECENT}`)).not.toBeNull();
    expect(await readCache(`meeting:${EXACTLY_30_DAYS}`)).not.toBeNull();
    expect(await readCache("online:3")).not.toBeNull();
    expect(await readCache("online:1")).toBeNull();
    expect(await readCache("online:2")).not.toBeNull();
    expect(await readCache("vocabulary")).not.toBeNull();
    expect(await readCache("search:36.16,-86.78,25")).not.toBeNull();
  });

  it("never stops the app launching when old copies can't be pruned", async () => {
    const prune = await failStatements("runAsync", "delete from cache_entries where key like 'meeting:%'");
    await renderApp("/saved");
    expect(await screen.findByText(EMPTY)).toBeOnTheScreen();
    await waitFor(() => {
      expect(prune).toHaveBeenCalledWith(
        expect.stringMatching(/^delete from cache_entries where key like 'meeting:%'/),
        [expect.any(Number)],
      );
    });
    await launchReadsLanded();
  });

  it("runs at launch", async () => {
    setNow("2026-09-01T12:00:00Z");
    await writeCache(`meeting:${OTHER}`, { meeting: meeting({ id: OTHER }) });
    setNow("2026-10-05T12:00:00Z");
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    await renderApp("/saved");
    // The card's tag label means launch's reads have landed.
    expect(await screen.findByRole("button", { name: CARD })).toBeOnTheScreen();
    await waitFor(async () => {
      expect(await readCache(`meeting:${OTHER}`)).toBeNull();
    });
  });
});
