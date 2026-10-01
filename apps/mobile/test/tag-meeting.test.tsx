import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, AppState, type AppStateStatus } from "react-native";

import { readCache, writeCache } from "@/cache/store";
import { appDatabase } from "@/db/database";
import { meetingMoved } from "@/meetings/merged";
import { myTagsOn, recordSubmission } from "@/tagging/my-tags";
import { saveNewCounts } from "@/tagging/new-counts";

import { startApi, type TestApi } from "./api-server";
import { failStatements, resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { launchReadsLanded, renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SURVIVOR = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
const PATH = `/api/v1/meetings/${ID}`;
// Nooners (fixtures.ts) meets Mondays 12:00–1:00 PM in Chicago: Monday 5 October 2026 at noon is 17:00 UTC.
const STARTED = "2026-10-05T17:00:00Z";
const COUNTS = [
  { slug: "welcoming", count: 15 },
  { slug: "coffee", count: 1 },
];

let api: TestApi;
let announce: jest.SpyInstance;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  api.reply(PATH, { meeting: meeting() });
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(async () => {
  await api.close();
});

const tagWrites = () => api.requests.filter((r) => r.path === "/api/v1/tags");
// What VoiceOver was moved to: the host component behind the app's ref, matched by its props.
const focusedOn = (props: Record<string, string>): unknown =>
  expect.objectContaining({ props: expect.objectContaining(props) as unknown });
const meetingReads = () => api.requests.filter((r) => r.path === PATH);

// AppState is what the app hands foreground changes off to; the spy lets a test play them.
function spyOnAppState() {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.add(listener);
    return {
      remove: () => {
        listeners.delete(listener);
      },
    };
  });
  return async (state: AppStateStatus) => {
    await act(() => {
      for (const listener of listeners) listener(state);
    });
  };
}

async function openMeeting(at = STARTED) {
  setNow(at);
  await renderApp(`/meeting/${ID}`);
  await screen.findByLabelText("Welcoming 14 people");
}

// The tag section shows nothing until it has read the phone's own record, so each test waits for it to appear.
const tagButton = () => screen.findByRole("button", { name: "Tag this meeting" });

async function choose(...labels: string[]) {
  for (const label of labels) await fireEvent.press(screen.getByRole("checkbox", { name: label }));
}

async function tag(...labels: string[]) {
  await fireEvent.press(await tagButton());
  await choose(...labels);
  await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
}

describe("Tag this meeting", () => {
  it.each([
    ["a minute before it starts", "2026-10-05T16:59:00Z", false],
    ["as it starts", STARTED, true],
    ["35 hours 59 minutes later", "2026-10-07T04:59:00Z", true],
    ["36 hours later", "2026-10-07T05:00:00Z", false],
  ])("is offered only from the start until 36 hours after: %s", async (_when, at, offered) => {
    await openMeeting(at);
    if (offered) {
      expect(await tagButton()).toHaveProp(
        "accessibilityHint",
        "For a meeting you went to: choose words that describe it",
      );
    } else {
      expect(
        await screen.findByText("You can add tags from the start of this meeting until 36 hours after."),
      ).toBeOnTheScreen();
      expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
    }
  });

  it("lists the tags by category and sends the chosen ones, with this phone's headers and nothing else", async () => {
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting();
    await fireEvent.press(await tagButton());
    for (const category of ["Format", "Sharing", "Crowd", "Feel", "Practical"]) {
      expect(screen.getByRole("header", { name: category })).toBeOnTheScreen();
    }
    expect(screen.getByText("Choose up to 6 words that describe this meeting.")).toBeOnTheScreen();
    await choose("Welcoming", "Coffee");
    expect(screen.getByText("2 of 6 chosen")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    expect(await screen.findByText("Thanks. Your tags are added.")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith("Thanks. Your tags are added.");
    const [write] = tagWrites();
    expect(write?.method).toBe("POST");
    expect(write?.body).toBe(`{"meetingId":"${ID}","tags":["welcoming","coffee"],"nearMeeting":false}`);
    expect(write?.headers["x-platform"]).toBe("ios");
    expect(write?.headers["x-app-version"]).toBe("0.1.0");
    expect(write?.headers["x-device-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("shows the server's new counts at once, and keeps them in the saved copy without making it look newer", async () => {
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    // A copy saved half an hour ago, still inside its reuse window: the page shows it without asking the server.
    const savedAt = new Date("2026-10-05T16:30:00Z");
    await writeCache(`meeting:${ID}`, { meeting: meeting() }, savedAt);
    await openMeeting();
    await tag("Welcoming", "Coffee");
    expect(await screen.findByLabelText("Welcoming 15 people")).toBeOnTheScreen();
    expect(screen.getByLabelText("Coffee 1 person")).toBeOnTheScreen();
    await waitFor(async () => {
      expect((await readCache(`meeting:${ID}`))?.body).toEqual({ meeting: meeting({ tags: COUNTS }) });
    });
    expect((await readCache(`meeting:${ID}`))?.savedAt).toEqual(savedAt);
  });

  it("keeps a record on the phone, shows it, and offers no second new tagging that week", async () => {
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting();
    await tag("Welcoming", "Coffee");
    expect(await screen.findByText("Your tags: Welcoming · Coffee")).toBeOnTheScreen();
    expect(screen.getByText("Added Oct 5, 2026")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
    expect(await myTagsOn(ID)).toEqual({
      meetingId: ID,
      name: "Nooners",
      tags: ["welcoming", "coffee"],
      confirmedAt: new Date(STARTED),
      updatedAt: new Date(STARTED),
    });
  });

  it("offers a new tagging again once the phone's last one is a week old", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-09-28T17:00:00Z"));
    await openMeeting();
    expect(await screen.findByText("Your tags: Quiet")).toBeOnTheScreen();
    expect(screen.getByText("Added Sep 28, 2026")).toBeOnTheScreen();
    expect(await tagButton()).toBeOnTheScreen();
  });

  it("is offered while the config is still being read: the server decides", async () => {
    const answerConfig = api.answerLater("/api/v1/config");
    await openMeeting();
    expect(await tagButton()).toBeOnTheScreen();
    answerConfig(CONFIG);
    await launchReadsLanded();
    expect(screen.getByRole("button", { name: "Tag this meeting" })).toBeOnTheScreen();
  });

  it("shows the new counts on an old saved copy and still says it's old", async () => {
    await writeCache(`meeting:${ID}`, { meeting: meeting() }, new Date("2026-10-05T14:00:00Z"));
    api.reply(PATH, { error: { code: "server_error", message: "Something went wrong." } }, 500);
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting();
    expect(screen.getByText(/mymeetingapp is having trouble right now/)).toBeOnTheScreen();
    await tag("Welcoming", "Coffee");
    expect(await screen.findByLabelText("Welcoming 15 people")).toBeOnTheScreen();
    expect(screen.getByText(/mymeetingapp is having trouble right now/)).toBeOnTheScreen();
  });

  it("still offers tagging when the phone's own record can't be read", async () => {
    await failStatements("getFirstAsync", "select meeting_id, name, tags");
    await openMeeting();
    expect(await tagButton()).toBeOnTheScreen();
  });

  // The server has the tags, so the page says so; the phone learns of them again from the server (already_tagged).
  it("thanks and shows the new counts even when the phone can't save its own record", async () => {
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await failStatements("runAsync", "insert or replace into my_tags");
    await openMeeting();
    await tag("Welcoming", "Coffee");
    expect(await screen.findByText("Thanks. Your tags are added.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Welcoming 15 people")).toBeOnTheScreen();
    expect(await myTagsOn(ID)).toBeNull();
  });

  it("can't be sent twice while the server is still answering", async () => {
    const answer = api.answerLater("/api/v1/tags");
    await openMeeting();
    await tag("Quiet");
    expect(screen.queryByRole("button", { name: "Send my tags" })).toBeNull();
    expect(screen.getByLabelText("Sending your tags")).toBeOnTheScreen();
    await waitFor(() => {
      expect(tagWrites()).toHaveLength(1);
    });
    answer({ meetingId: ID, tags: COUNTS });
    expect(await screen.findByText("Thanks. Your tags are added.")).toBeOnTheScreen();
  });

  it("keeps the counts a write answered with when a read that started before it lands afterwards", async () => {
    const appState = spyOnAppState();
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting();
    // Past the copy's reuse window (and still in the tagging window), so coming back reads the meeting again.
    setNow("2026-10-05T18:30:00Z");
    const answerRead = api.answerLater(PATH);
    await appState("background");
    await appState("active");
    await waitFor(() => {
      expect(meetingReads()).toHaveLength(2);
    });
    await tag("Welcoming", "Coffee");
    expect(await screen.findByLabelText("Welcoming 15 people")).toBeOnTheScreen();
    answerRead({ meeting: meeting() });
    await waitFor(async () => {
      expect((await readCache(`meeting:${ID}`))?.savedAt).toEqual(new Date("2026-10-05T18:30:00Z"));
    });
    expect(screen.getByLabelText("Welcoming 15 people")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Welcoming 14 people")).toBeNull();
  });

  it("moves VoiceOver to the picker when it opens, and back to the page when it closes", async () => {
    const focus = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => undefined);
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting();
    await fireEvent.press(await tagButton());
    expect(focus).toHaveBeenLastCalledWith(focusedOn({ children: "Tag this meeting" }), "focus");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(focus).toHaveBeenLastCalledWith(focusedOn({ accessibilityLabel: "Tag this meeting" }), "focus");
    expect(focus).toHaveBeenCalledTimes(2);
    await tag("Welcoming", "Coffee");
    expect(await screen.findByText("Your tags: Welcoming · Coffee")).toBeOnTheScreen();
    expect(focus).toHaveBeenLastCalledWith(focusedOn({ children: "Your tags: Welcoming · Coffee" }), "focus");
  });

  it("lets at most 6 tags be chosen, and says so", async () => {
    await openMeeting();
    await fireEvent.press(await tagButton());
    await choose("Laid back", "Quiet", "Coffee", "Welcoming", "Lively", "Serious tone", "Runs long");
    expect(screen.getByText("6 of 6 chosen")).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Runs long" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Serious tone" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose up to 6 tags.");
    expect(announce).toHaveBeenCalledWith("Choose up to 6 tags.");
  });

  it("asks for at least one tag and sends nothing without one", async () => {
    await openMeeting();
    await fireEvent.press(await tagButton());
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one tag.");
    expect(tagWrites()).toEqual([]);
  });

  it("closes the picker on Cancel, sending nothing", async () => {
    await openMeeting();
    await fireEvent.press(await tagButton());
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("checkbox", { name: "Quiet" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tag this meeting" })).toBeOnTheScreen();
    expect(tagWrites()).toEqual([]);
  });

  // A record from more than a week ago would otherwise bring the button back, and its line shows the section has
  // read it: the button's absence then means something.
  it("isn't offered when the group asked not to be tagged", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-09-28T17:00:00Z"));
    api.reply(PATH, { meeting: meeting({ tagsDisabled: true, tags: [] }) });
    setNow(STARTED);
    await renderApp(`/meeting/${ID}`);
    await launchReadsLanded();
    expect(await screen.findByText("This group has asked not to be tagged.")).toBeOnTheScreen();
    expect(await screen.findByText("Your tags: Quiet")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
  });

  it.each([
    [
      "tagging is switched off",
      { meeting: meeting() },
      { ...CONFIG, features: { tagging: false, suggestions: true } },
      "Tagging isn't available for this right now.",
    ],
    [
      "the app is below the minimum version",
      { meeting: meeting() },
      { ...CONFIG, minSupportedVersion: { ios: "9.0.0", android: "9.0.0" } },
      "This version of the app is too old. Please update it to keep adding tags.",
    ],
    [
      "the listing has no time zone",
      { meeting: meeting({ timezone: null }) },
      CONFIG,
      "This meeting's listing doesn't give its time zone, so it can't be tagged.",
    ],
  ])("isn't offered when %s, and says why", async (_why, detail, config, message) => {
    api.reply("/api/v1/config", config);
    api.reply(PATH, detail);
    setNow(STARTED);
    await renderApp(`/meeting/${ID}`);
    await launchReadsLanded();
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
  });

  it.each([
    ["rate_limited", "You've reached today's limit. Please try again tomorrow.", 429],
    ["device_blocked", "Tagging isn't available from this device.", 403],
    ["window_closed", "New tags can be added from the start of the meeting until 36 hours after.", 403],
    ["upgrade_required", "This version of the app is too old. Please update it to keep adding tags.", 426],
    [
      "meeting_not_found",
      "We couldn't find that meeting. It may have been removed from the meeting list.",
      404,
    ],
    ["tags_disabled", "Tagging isn't available for this right now.", 403],
  ])(
    "shows the server's words for %s, keeps the choices and records nothing",
    async (code, message, status) => {
      api.reply("/api/v1/tags", { error: { code, message } }, status, "POST");
      await openMeeting();
      await tag("Quiet");
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(announce).toHaveBeenCalledWith(message);
      expect(screen.getByRole("checkbox", { name: "Quiet" })).toBeChecked();
      expect(await myTagsOn(ID)).toBeNull();
    },
  );

  it("says it can't tell whether the tags were saved when the server can't be reached", async () => {
    // No reply set for the POST: the test server answers 599 with no envelope.
    await openMeeting();
    await tag("Quiet");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach mymeetingapp, so we can't tell whether your tags were saved. Check your connection and try again.",
    );
    expect(screen.getByRole("checkbox", { name: "Quiet" })).toBeChecked();
    expect(await myTagsOn(ID)).toBeNull();
  });

  it("offers no tags to choose while the tag list hasn't loaded, and nothing to send", async () => {
    // The tag list can't be read (no saved copy either), so no tag has a name to choose by.
    api.reply(
      "/api/v1/vocabulary",
      { error: { code: "server_error", message: "Something went wrong." } },
      500,
    );
    setNow(STARTED);
    await renderApp(`/meeting/${ID}`);
    await fireEvent.press(await tagButton());
    expect(
      screen.getAllByText("Tag names haven't loaded yet. They'll appear when you're back online."),
    ).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send my tags" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeOnTheScreen();
  });

  it("reads the tag list again after a tag was retired, and drops it from the choices", async () => {
    api.reply(
      "/api/v1/tags",
      {
        error: {
          code: "unknown_tag",
          message: "One of those tags isn't available anymore. Refresh the list and try again.",
        },
      },
      400,
      "POST",
    );
    await openMeeting();
    api.reply("/api/v1/vocabulary", { tags: VOCABULARY.tags.filter((t) => t.slug !== "coffee") });
    await tag("Quiet", "Coffee");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "One of those tags isn't available anymore. Refresh the list and try again.",
    );
    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: "Coffee" })).toBeNull();
    });
    expect(screen.getByText("1 of 6 chosen")).toBeOnTheScreen();
  });
});

describe("saveNewCounts", () => {
  // A merged meeting's moved copy still names the old id inside (meetingMoved copies the body as it was). Left that
  // way, the page reading it would see another meeting than the one it asked for and follow it back.
  it("files the counts with the id the server answered for, so a saved copy always names its own meeting", async () => {
    const savedAt = new Date("2026-10-05T16:00:00Z");
    await writeCache(`meeting:${SURVIVOR}`, { meeting: meeting() }, savedAt);
    await saveNewCounts({ meetingId: SURVIVOR, tags: COUNTS });
    expect(await readCache(`meeting:${SURVIVOR}`)).toEqual({
      body: { meeting: meeting({ id: SURVIVOR, tags: COUNTS }) },
      savedAt,
    });
  });
});

describe("saveNewCounts, racing another save", () => {
  it("leaves a newer copy alone when one lands while it's saving", async () => {
    const newer = { meeting: meeting({ name: "Nooners (renamed)" }) };
    const newerAt = new Date("2026-10-05T17:00:00Z");
    await writeCache(`meeting:${ID}`, { meeting: meeting() }, new Date("2026-10-05T16:00:00Z"));
    const db = await appDatabase();
    const real = db.getFirstAsync.bind(db);
    // The newer copy lands just after saveNewCounts has read the old one.
    jest.spyOn(db, "getFirstAsync").mockImplementationOnce(async (source, params) => {
      const row = await real(source, params);
      await writeCache(`meeting:${ID}`, newer, newerAt);
      return row;
    });
    await saveNewCounts({ meetingId: ID, tags: COUNTS });
    expect(await readCache(`meeting:${ID}`)).toEqual({ body: newer, savedAt: newerAt });
  });
});

describe("meetingMoved and the tag record", () => {
  it("keeps the surviving meeting's own record when the phone tagged both ids", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-09-28T17:00:00Z"));
    await recordSubmission({ id: SURVIVOR, name: "Nooners (merged)" }, ["coffee"], new Date(STARTED));
    await meetingMoved(ID, SURVIVOR, "move");
    expect(await myTagsOn(SURVIVOR)).toEqual({
      meetingId: SURVIVOR,
      name: "Nooners (merged)",
      tags: ["coffee"],
      confirmedAt: new Date(STARTED),
      updatedAt: new Date(STARTED),
    });
    expect(await myTagsOn(ID)).toBeNull();
  });
});
