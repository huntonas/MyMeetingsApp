import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { readCache, writeCache } from "@/cache/store";
import { myTagsOn, recordSubmission } from "@/tagging/my-tags";

import { startApi, type TestApi } from "./api-server";
import { failStatements, resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { launchReadsLanded, renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SURVIVOR = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
const PATH = `/api/v1/meetings/${ID}`;
const TAG_PATH = `/api/v1/tags/${ID}`;
// Nooners (fixtures.ts) meets Mondays 12:00–1:00 PM in Chicago: Monday 5 October 2026 at noon is 17:00 UTC.
const STARTED = "2026-10-05T17:00:00Z";
const LATER = "2026-10-22T17:00:00Z"; // a Thursday: no Nooners window is open
const RECORDED = new Date("2026-10-05T17:00:00Z");
const COUNTS = [
  { slug: "welcoming", count: 14 },
  { slug: "quiet", count: 2 },
];
const GONE = "We couldn't find that meeting. It may have been removed from the meeting list.";

let api: TestApi;
let announce: jest.SpyInstance;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v2/vocabulary", VOCABULARY);
  api.reply(PATH, { meeting: meeting() });
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(async () => {
  await api.close();
});

const writes = () => api.requests.filter((r) => r.path.startsWith("/api/v1/tags"));

async function openMeeting(at = STARTED) {
  setNow(at);
  const app = await renderApp(`/meeting/${ID}`);
  await screen.findByLabelText("Welcoming 14 people");
  return app;
}

// The tag section shows nothing until it has read the phone's own record: its line says it has.
async function openTagged(at = LATER) {
  const app = await openMeeting(at);
  await screen.findByText("Your tags: Welcoming");
  return app;
}

async function choose(...labels: string[]) {
  for (const label of labels) await fireEvent.press(screen.getByRole("checkbox", { name: label }));
}

async function remove() {
  await fireEvent.press(await screen.findByRole("button", { name: "Remove my tags" }));
  expect(screen.getByText("Remove your tags from this meeting? Other people's tags stay.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Remove my tags" }));
}

describe("a meeting this phone tagged", () => {
  beforeEach(async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["welcoming"], RECORDED);
  });

  it("offers Edit and Remove at any time, and no new tagging outside the window", async () => {
    await openTagged();
    expect(screen.getByRole("button", { name: "Edit my tags" })).toHaveProp(
      "accessibilityHint",
      "Change the tags this phone added",
    );
    expect(screen.getByRole("button", { name: "Remove my tags" })).toHaveProp(
      "accessibilityHint",
      "Asks before removing this phone's tags from this meeting",
    );
    expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
  });

  it("edits starting from its tags, keeps the first date, and shows the new counts", async () => {
    api.reply(TAG_PATH, { meetingId: ID, tags: COUNTS }, 200, "PUT");
    await openTagged();
    await fireEvent.press(screen.getByRole("button", { name: "Edit my tags" }));
    expect(screen.getByRole("header", { name: "Edit my tags" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Welcoming" })).toBeChecked();
    await choose("Quiet");
    expect(screen.getByRole("button", { name: "Save my tags" })).toHaveProp(
      "accessibilityHint",
      "Replaces this phone's tags on this meeting",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
    expect(await screen.findByText("Your tags are saved.")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith("Your tags are saved.");
    expect(screen.getByLabelText("Quiet 2 people")).toBeOnTheScreen();
    expect(screen.getByText("Your tags: Welcoming · Quiet")).toBeOnTheScreen();
    expect(screen.getByText("Added Oct 5, 2026")).toBeOnTheScreen();
    const [write] = writes();
    expect(write?.method).toBe("PUT");
    expect(write?.body).toBe('{"tags":["welcoming","quiet"]}');
    expect(write?.headers["x-device-id"]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await myTagsOn(ID)).toEqual({
      meetingId: ID,
      name: "Nooners",
      tags: ["welcoming", "quiet"],
      confirmedAt: RECORDED,
      updatedAt: new Date(LATER),
    });
  });

  it("removes after asking, sending no body, and forgets the record", async () => {
    api.reply(TAG_PATH, { meetingId: ID, tags: [{ slug: "welcoming", count: 13 }] }, 200, "DELETE");
    await openTagged();
    await remove();
    expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith("Your tags are removed.");
    expect(screen.getByLabelText("Welcoming 13 people")).toBeOnTheScreen();
    expect(writes()[0]).toMatchObject({ method: "DELETE", body: "" });
    expect(await myTagsOn(ID)).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove my tags" })).toBeNull();
    expect(screen.queryByText(/^Your tags: /)).toBeNull();
  });

  it("keeps them, sending nothing, when the question is answered Keep them", async () => {
    await openTagged();
    await fireEvent.press(screen.getByRole("button", { name: "Remove my tags" }));
    await fireEvent.press(screen.getByRole("button", { name: "Keep them" }));
    expect(screen.getByRole("button", { name: "Remove my tags" })).toBeOnTheScreen();
    expect(writes()).toEqual([]);
  });

  it("can't remove twice while the server is still answering", async () => {
    const answer = api.answerLater(TAG_PATH);
    await openTagged();
    await remove();
    expect(await screen.findByLabelText("Removing your tags")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Remove my tags" })).toBeNull();
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    answer({ meetingId: ID, tags: [] });
    expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
    expect(writes()).toHaveLength(1);
  });

  it("offers no Edit or new tagging while a removal is still out", async () => {
    const answer = api.answerLater(TAG_PATH);
    // A week on, in the next meeting's window: Tag this meeting is offered beside Edit and Remove.
    await openTagged("2026-10-12T17:00:00Z");
    expect(screen.getByRole("button", { name: "Tag this meeting" })).toBeOnTheScreen();
    await remove();
    expect(await screen.findByLabelText("Removing your tags")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Edit my tags" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
    answer({ meetingId: ID, tags: [] });
    expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
  });

  it("keeps the record, and says it can't tell, when the server can't be reached", async () => {
    // No reply set for the DELETE: the test server answers 599 with no envelope.
    await openTagged();
    await remove();
    expect(
      await screen.findByText(
        "We couldn't reach My Meeting App, so we can't tell whether your tags were removed. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    expect(await myTagsOn(ID)).toMatchObject({ tags: ["welcoming"] });
    expect(screen.getByRole("button", { name: "Remove my tags" })).toBeOnTheScreen();
  });

  it("says the tags are removed when a retry finds none, after a removal it couldn't confirm", async () => {
    // No reply set for the first DELETE: the test server answers 599, as when the connection drops after the server
    // removed them.
    await openTagged();
    await remove();
    expect(
      await screen.findByText(
        "We couldn't reach My Meeting App, so we can't tell whether your tags were removed. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    api.reply(
      TAG_PATH,
      { error: { code: "not_tagged", message: "You haven't tagged this meeting." } },
      404,
      "DELETE",
    );
    await remove();
    expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
    expect(screen.queryByText("You haven't tagged this meeting.")).toBeNull();
    expect(await myTagsOn(ID)).toBeNull();
  });

  it("shows the server's words when a retry finds none after a refusal, which removed nothing", async () => {
    api.reply(
      TAG_PATH,
      {
        error: { code: "rate_limited", message: "You've reached today's limit. Please try again tomorrow." },
      },
      429,
      "DELETE",
    );
    await openTagged();
    await remove();
    expect(
      await screen.findByText("You've reached today's limit. Please try again tomorrow."),
    ).toBeOnTheScreen();
    api.reply(
      TAG_PATH,
      { error: { code: "not_tagged", message: "You haven't tagged this meeting." } },
      404,
      "DELETE",
    );
    await remove();
    expect(await screen.findByText("You haven't tagged this meeting.")).toBeOnTheScreen();
    expect(screen.queryByText("Your tags are removed.")).toBeNull();
  });

  it("keeps the record and shows the server's words when it refuses for another reason", async () => {
    api.reply(
      TAG_PATH,
      {
        error: { code: "rate_limited", message: "You've reached today's limit. Please try again tomorrow." },
      },
      429,
      "DELETE",
    );
    await openTagged();
    await remove();
    expect(
      await screen.findByText("You've reached today's limit. Please try again tomorrow."),
    ).toBeOnTheScreen();
    expect(await myTagsOn(ID)).toMatchObject({ tags: ["welcoming"] });
  });

  it("keeps Remove when tagging is switched off or the app is too old, and hides Edit", async () => {
    api.reply("/api/v1/config", {
      ...CONFIG,
      minSupportedVersion: { ios: "9.0.0", android: "9.0.0" },
      features: { tagging: false, suggestions: false },
    });
    await openTagged();
    await launchReadsLanded();
    expect(screen.getByRole("button", { name: "Remove my tags" })).toBeOnTheScreen();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Edit my tags" })).toBeNull();
    });
  });

  it("keeps Remove and hides Edit when the group asked not to be tagged", async () => {
    api.reply(PATH, { meeting: meeting({ tagsDisabled: true, tags: [] }) });
    setNow(LATER);
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText("This group has asked not to be tagged.")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Remove my tags" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Edit my tags" })).toBeNull();
  });

  it("offers Tag this meeting again a week after the last time, starting from the same tags", async () => {
    await openTagged("2026-10-12T17:00:00Z");
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    expect(screen.getByRole("header", { name: "Tag this meeting" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Welcoming" })).toBeChecked();
  });

  it.each([
    ["PUT", "Edit"],
    ["DELETE", "Remove"],
  ])("forgets its record when the server holds no tags from this phone (%s)", async (method, action) => {
    api.reply(
      TAG_PATH,
      { error: { code: "not_tagged", message: "You haven't tagged this meeting." } },
      404,
      method,
    );
    await openTagged();
    if (action === "Edit") {
      await fireEvent.press(screen.getByRole("button", { name: "Edit my tags" }));
      await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
    } else {
      await remove();
    }
    expect(await screen.findByText("You haven't tagged this meeting.")).toBeOnTheScreen();
    expect(await myTagsOn(ID)).toBeNull();
    await waitFor(() => {
      expect(screen.queryByText(/^Your tags: /)).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Remove my tags" })).toBeNull();
    // Outside the tagging window there's nothing to send instead, so the picker closes on the server's words.
    expect(screen.queryByRole("button", { name: "Save my tags" })).toBeNull();
    expect(
      screen.getByText("You can add tags from the start of this meeting until 36 hours after."),
    ).toBeOnTheScreen();
  });

  it("turns the edit into a new tagging, keeping the choices, when the server holds none and the window is open", async () => {
    api.reply(
      TAG_PATH,
      { error: { code: "not_tagged", message: "You haven't tagged this meeting." } },
      404,
      "PUT",
    );
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openTagged("2026-10-05T18:00:00Z");
    await fireEvent.press(screen.getByRole("button", { name: "Edit my tags" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
    expect(await screen.findByText("You haven't tagged this meeting.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Tag this meeting" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Quiet" })).toBeChecked();
    expect(await myTagsOn(ID)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    expect(await screen.findByText("Thanks. Your tags are added.")).toBeOnTheScreen();
    expect(writes().map((w) => [w.method, w.body])).toEqual([
      ["PUT", '{"tags":["welcoming","quiet"]}'],
      ["POST", `{"meetingId":"${ID}","tags":["welcoming","quiet"],"nearMeeting":false}`],
    ]);
  });

  it("can remove its tags from a meeting that's no longer listed", async () => {
    api.reply(PATH, { error: { code: "meeting_not_found", message: GONE } }, 404);
    api.reply(TAG_PATH, { meetingId: ID, tags: [] }, 200, "DELETE");
    setNow(LATER);
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText(GONE)).toBeOnTheScreen();
    await remove();
    expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
    expect(await myTagsOn(ID)).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove my tags" })).toBeNull();
  });

  it("offers nothing to remove on a meeting that's no longer listed when this phone never tagged it", async () => {
    await resetAppData();
    api.reply(PATH, { error: { code: "meeting_not_found", message: GONE } }, 404);
    setNow(LATER);
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText(GONE)).toBeOnTheScreen();
    await launchReadsLanded();
    expect(screen.queryByRole("button", { name: "Remove my tags" })).toBeNull();
  });

  // The page's id still names the meeting the phone tagged; the server answered for the one it merged into.
  it("keeps the first date when the meeting merged before an edit landed", async () => {
    api.reply(TAG_PATH, { meetingId: SURVIVOR, tags: COUNTS }, 200, "PUT");
    api.reply(`/api/v1/meetings/${SURVIVOR}`, { meeting: meeting({ id: SURVIVOR, tags: COUNTS }) });
    await openTagged();
    await fireEvent.press(screen.getByRole("button", { name: "Edit my tags" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
    expect(await screen.findByText("Your tags: Welcoming · Quiet")).toBeOnTheScreen();
    await waitFor(async () => {
      expect(await myTagsOn(SURVIVOR)).toEqual({
        meetingId: SURVIVOR,
        name: "Nooners",
        tags: ["welcoming", "quiet"],
        confirmedAt: RECORDED,
        updatedAt: new Date(LATER),
      });
    });
    expect(await myTagsOn(ID)).toBeNull();
  });
});

describe("a phone whose record is missing or moved", () => {
  it("offers to save the choices as an edit when the server says this phone already tagged it", async () => {
    api.reply(
      "/api/v1/tags",
      {
        error: {
          code: "already_tagged",
          message: "You've already tagged this meeting in the last 7 days. You can edit your tags instead.",
        },
      },
      409,
      "POST",
    );
    api.reply(TAG_PATH, { meetingId: ID, tags: COUNTS }, 200, "PUT");
    await openMeeting(STARTED);
    await fireEvent.press(await screen.findByRole("button", { name: "Tag this meeting" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    expect(await screen.findByText(/You can edit your tags instead\./)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Edit my tags" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Quiet" })).toBeChecked();
    await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
    expect(await screen.findByText("Your tags are saved.")).toBeOnTheScreen();
    expect(writes().map((w) => [w.method, w.body])).toEqual([
      ["POST", `{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":false}`],
      ["PUT", '{"tags":["quiet"]}'],
    ]);
    expect(await myTagsOn(ID)).toMatchObject({ tags: ["quiet"], confirmedAt: new Date(STARTED) });
  });

  it("follows a meeting that merged before the write landed", async () => {
    api.reply("/api/v1/tags", { meetingId: SURVIVOR, tags: COUNTS }, 201, "POST");
    api.reply(`/api/v1/meetings/${SURVIVOR}`, { meeting: meeting({ id: SURVIVOR, tags: COUNTS }) });
    setNow(STARTED);
    const app = await renderApp(`/meeting/${ID}`);
    await screen.findByLabelText("Welcoming 14 people");
    await fireEvent.press(await screen.findByRole("button", { name: "Tag this meeting" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
    });
    expect(await screen.findByText("Your tags: Quiet")).toBeOnTheScreen();
    expect(screen.getByText("Thanks. Your tags are added.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Quiet 2 people")).toBeOnTheScreen();
    expect(await myTagsOn(SURVIVOR)).toMatchObject({ tags: ["quiet"] });
    expect(await myTagsOn(ID)).toBeNull();
    // The copy under the survivor's key names the survivor, so the page reading it stays there.
    expect(await readCache(`meeting:${SURVIVOR}`)).toMatchObject({
      body: { meeting: { id: SURVIVOR, tags: COUNTS } },
    });
    expect(await readCache(`meeting:${ID}`)).toBeNull();
  });

  it("stays on the merged meeting when the new counts can't be saved", async () => {
    api.reply("/api/v1/tags", { meetingId: SURVIVOR, tags: COUNTS }, 201, "POST");
    api.reply(`/api/v1/meetings/${SURVIVOR}`, { meeting: meeting({ id: SURVIVOR, tags: COUNTS }) });
    await failStatements("runAsync", "update cache_entries");
    setNow(STARTED);
    const app = await renderApp(`/meeting/${ID}`);
    await screen.findByLabelText("Welcoming 14 people");
    await fireEvent.press(await screen.findByRole("button", { name: "Tag this meeting" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
    });
    expect(await screen.findByText("Your tags: Quiet")).toBeOnTheScreen();
    expect((await readCache(`meeting:${SURVIVOR}`))?.body).toMatchObject({ meeting: { id: SURVIVOR } });
    expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
  });
});

describe("a write that finds the meeting merged", () => {
  const SURVIVOR_PATH = `/api/v1/meetings/${SURVIVOR}`;
  const survivor = meeting({ id: SURVIVOR, name: "Nooners (merged)", tags: COUNTS });

  it("keeps the survivor's own saved copy rather than the old meeting's details", async () => {
    api.reply("/api/v1/tags", { meetingId: SURVIVOR, tags: COUNTS }, 201, "POST");
    api.reply(SURVIVOR_PATH, { meeting: survivor });
    const savedAt = new Date("2026-10-05T16:30:00Z");
    await writeCache(
      `meeting:${SURVIVOR}`,
      { meeting: meeting({ id: SURVIVOR, name: "Nooners (merged)" }) },
      savedAt,
    );
    const app = await openMeeting(STARTED);
    await fireEvent.press(await screen.findByRole("button", { name: "Tag this meeting" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
    });
    expect(await screen.findByText("Nooners (merged)")).toBeOnTheScreen();
    expect(await readCache(`meeting:${SURVIVOR}`)).toEqual({
      body: { meeting: meeting({ id: SURVIVOR, name: "Nooners (merged)", tags: COUNTS }) },
      savedAt,
    });
    expect(await readCache(`meeting:${ID}`)).toBeNull();
  });

  describe("when this phone had tagged both meetings", () => {
    beforeEach(async () => {
      await recordSubmission({ id: ID, name: "Nooners" }, ["welcoming"], RECORDED);
      await recordSubmission(
        { id: SURVIVOR, name: "Nooners (merged)" },
        ["coffee"],
        new Date("2026-09-21T17:00:00Z"),
      );
      api.reply(SURVIVOR_PATH, { meeting: survivor });
    });

    // The server makes the phone's two rows one, with the edit's tags.
    it("keeps the edit as the survivor's record", async () => {
      api.reply(TAG_PATH, { meetingId: SURVIVOR, tags: COUNTS }, 200, "PUT");
      const app = await openTagged();
      await fireEvent.press(screen.getByRole("button", { name: "Edit my tags" }));
      await choose("Quiet");
      await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
      await waitFor(() => {
        expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
      });
      expect(await screen.findByText("Your tags: Welcoming · Quiet")).toBeOnTheScreen();
      expect(await myTagsOn(SURVIVOR)).toEqual({
        meetingId: SURVIVOR,
        name: "Nooners",
        tags: ["welcoming", "quiet"],
        confirmedAt: RECORDED,
        updatedAt: new Date(LATER),
      });
      expect(await myTagsOn(ID)).toBeNull();
    });

    // The server deletes both of the phone's rows.
    it("forgets both records on a removal", async () => {
      api.reply(TAG_PATH, { meetingId: SURVIVOR, tags: [] }, 200, "DELETE");
      const app = await openTagged();
      await remove();
      await waitFor(() => {
        expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
      });
      expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
      expect(await myTagsOn(ID)).toBeNull();
      expect(await myTagsOn(SURVIVOR)).toBeNull();
      expect(screen.queryByText(/^Your tags: /)).toBeNull();
    });
  });
});
