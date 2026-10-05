import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, type AppStateStatus, Linking, Platform } from "react-native";

import { readCache, writeCache } from "@/cache/store";
import { appDatabase } from "@/db/database";
import { directionsUrl } from "@/meetings/directions";
import { recordNear, wasNear } from "@/tagging/attendance-record";
import { myTagsOn, recordSubmission } from "@/tagging/my-tags";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { LARGEST_TEXT, setFontScale } from "./font-scale";
import { permissionChecks, permissionRequests } from "./native/expo-location";
import { renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SURVIVOR = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
const PATH = `/api/v1/meetings/${ID}`;
const WHEN = "Mondays, 12:00 PM to 1:00 PM";

let api: TestApi;
let openURL: jest.SpyInstance;

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v2/vocabulary", VOCABULARY);
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(async () => {
  await api.close();
});

const meetingRequests = () => api.requests.filter((r) => r.path.startsWith("/api/v1/meetings/"));

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

describe("directionsUrl", () => {
  it.each([
    [
      { latitude: 36.1627, longitude: -86.7816, formattedAddress: "1 Main St" },
      "ios",
      "https://maps.apple.com/?daddr=36.1627%2C-86.7816",
    ],
    [
      { latitude: 36.1627, longitude: -86.7816, formattedAddress: "1 Main St" },
      "android",
      "https://www.google.com/maps/dir/?api=1&destination=36.1627%2C-86.7816",
    ],
    [
      { latitude: null, longitude: null, formattedAddress: "1 Main St, Nashville, TN" },
      "ios",
      "https://maps.apple.com/?daddr=1%20Main%20St%2C%20Nashville%2C%20TN",
    ],
    [
      { latitude: null, longitude: null, formattedAddress: "1 Main St, Nashville, TN" },
      "android",
      "https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St%2C%20Nashville%2C%20TN",
    ],
    // The contract lets each coordinate be missing on its own; half a point is no place.
    [
      { latitude: 36.1627, longitude: null, formattedAddress: "1 Main St" },
      "ios",
      "https://maps.apple.com/?daddr=1%20Main%20St",
    ],
    [{ latitude: null, longitude: null, formattedAddress: null }, "ios", null],
  ] as const)("%j on %s opens %s", (place, platform, url) => {
    expect(directionsUrl(place, platform)).toBe(url);
  });
});

describe("the meeting page", () => {
  it("shows when, where, types, what people say and where the listing came from", async () => {
    api.reply(PATH, {
      meeting: meeting({
        locationNotes: "Side door, upstairs",
        groupName: "Nooners Group",
        tags: [
          { slug: "welcoming", count: 14 },
          { slug: "quiet", count: 1 },
          { slug: "coffee", count: 3 },
          { slug: "lively", count: 2 },
        ],
      }),
    });
    // A Tuesday: outside the meeting's time, a page doesn't so much as look at the location permission (during it,
    // the attendance check does: attendance-check.test.tsx).
    setNow("2026-10-06T17:00:00Z");
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText(WHEN)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Nooners" })).toBeOnTheScreen();
    // The phone keeps the meeting's own time (both in Chicago), so there's nothing to convert.
    expect(screen.queryByText(/your time/)).toBeNull();
    expect(screen.getByText("St. Luke's")).toBeOnTheScreen();
    expect(screen.getByText("1 Main St, Nashville, TN 37203, USA")).toBeOnTheScreen();
    expect(screen.getByText("Side door, upstairs")).toBeOnTheScreen();
    expect(screen.getByText("Open · Big Book")).toBeOnTheScreen();
    expect(screen.getByText("Nooners Group")).toBeOnTheScreen();
    // Owner decision, 2026-10-05: the app names AA only to say it isn't affiliated.
    expect(
      screen.getByText("Listings come from local service offices and may be out of date."),
    ).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "What people say" })).toBeOnTheScreen();
    // Every tag, not a card's top three, each read out with its count.
    expect(await screen.findByLabelText("Welcoming 14 people")).toBeOnTheScreen();
    expect(screen.getByLabelText("Quiet 1 person")).toBeOnTheScreen();
    expect(screen.getByLabelText("Coffee 3 people")).toBeOnTheScreen();
    expect(screen.getByLabelText("Lively 2 people")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Join online" })).toBeNull();
    expect(screen.getByRole("button", { name: "Help now: crisis lines" })).toBeOnTheScreen();

    // Only the meeting's own place is handed to Maps, which starts from the phone's location itself.
    expect(screen.getByRole("button", { name: "Directions" })).toHaveProp("accessibilityHint", "Opens Maps");
    await fireEvent.press(screen.getByRole("button", { name: "Directions" }));
    expect(openURL).toHaveBeenLastCalledWith("https://maps.apple.com/?daddr=36.1627%2C-86.7816");
    expect(screen.getByRole("button", { name: "Listed by aanashville.org" })).toHaveProp(
      "accessibilityHint",
      "Opens in your browser",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Listed by aanashville.org" }));
    expect(openURL).toHaveBeenLastCalledWith("https://aanashville.org/meetings/nooners");
    expect(permissionChecks()).toBe(0);
    expect(permissionRequests()).toBe(0);
  });

  // iOS titles the back button with the screen underneath, which here is the tab group, "(tabs)". The native header
  // isn't rendered in tests, so this reads what the header is told: the arrow alone (VoiceOver still says "Back").
  it("shows only the back arrow, never the tab group's name", async () => {
    // react-navigation passes the display mode to iOS 14 and later only.
    jest.spyOn(Platform, "Version", "get").mockReturnValue("26.5");
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    await screen.findByText(WHEN);
    const [header] = screen.container.queryAll(
      (node) => node.type === "RNSScreenStackHeaderConfig" && node.props.title === "Meeting",
    );
    expect(header).toHaveProp("backButtonDisplayMode", "minimal");
    // VoiceOver reads the back button by its title, which iOS otherwise takes from the screen underneath: "(tabs)".
    expect(header).toHaveProp("backTitle", "Back");
  });

  // A URL's userinfo comes before an "@", and the browser goes to the host after it.
  it("names the listing's real host, never the userinfo in front of it", async () => {
    api.reply(PATH, { meeting: meeting({ sourceUrl: "https://aa-intergroup.org@evil.example/meetings" }) });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByRole("button", { name: "Listed by evil.example" })).toBeOnTheScreen();
    expect(screen.queryByText(/aa-intergroup\.org/)).toBeNull();
  });

  it("hands directions to Google Maps on Android", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    await fireEvent.press(await screen.findByRole("button", { name: "Directions" }));
    expect(openURL).toHaveBeenCalledWith(
      "https://www.google.com/maps/dir/?api=1&destination=36.1627%2C-86.7816",
    );
  });

  it("lists a meeting in its own zone's time, and says when that is on the phone", async () => {
    setNow("2026-10-05T12:00:00Z");
    api.reply(PATH, { meeting: meeting({ timezone: "America/New_York" }) });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText(`${WHEN} (Eastern Time)`)).toBeOnTheScreen();
    expect(screen.getByText("That's Monday at 11:00 AM your time.")).toBeOnTheScreen();
  });

  it("offers no directions for an in-person meeting with no place to go to", async () => {
    api.reply(PATH, {
      meeting: meeting({ locationName: null, formattedAddress: null, latitude: null, longitude: null }),
    });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText(WHEN)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Directions" })).toBeNull();
  });

  it("offers joining online instead of directions for an online meeting", async () => {
    api.reply(PATH, {
      meeting: meeting({
        attendance: "online",
        locationName: null,
        formattedAddress: null,
        latitude: null,
        longitude: null,
        conferenceUrl: "https://zoom.us/j/123456",
        conferenceUrlNotes: "Password: serenity",
        conferencePhone: "+1 646 558 8656,,123456#",
      }),
    });
    await renderApp(`/meeting/${ID}`);
    await fireEvent.press(await screen.findByRole("button", { name: "Join online" }));
    expect(openURL).toHaveBeenLastCalledWith("https://zoom.us/j/123456");
    expect(screen.getByText("Password: serenity")).toBeOnTheScreen();
    // The number and passcode stay on screen, selectable, for a phone that can't dial them itself.
    expect(screen.getByText("+1 646 558 8656,,123456#")).toHaveProp("selectable", true);
    await fireEvent.press(screen.getByRole("button", { name: "Dial in" }));
    // A raw "#" ends a URL (Android cuts the call there, iOS refuses it), so it and "*" are percent-encoded.
    expect(openURL).toHaveBeenLastCalledWith("tel:+16465588656,,123456%23");
    expect(screen.queryByRole("button", { name: "Directions" })).toBeNull();
    expect(screen.queryByRole("header", { name: "Where" })).toBeNull();
  });

  it("offers both directions and joining online for a hybrid meeting", async () => {
    api.reply(PATH, {
      meeting: meeting({ attendance: "hybrid", conferenceUrl: "https://zoom.us/j/123456" }),
    });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByRole("button", { name: "Directions" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Join online" })).toBeOnTheScreen();
  });

  it("shows no tags for a group that asked not to be tagged", async () => {
    api.reply(PATH, { meeting: meeting({ tagsDisabled: true, tags: [] }) });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText("This group has asked not to be tagged.")).toBeOnTheScreen();
  });

  it("says so when no one has tagged it", async () => {
    api.reply(PATH, { meeting: meeting({ tags: [] }) });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText("No one has tagged this meeting yet.")).toBeOnTheScreen();
  });

  it("says so when the phone can't open a hand-off", async () => {
    openURL.mockRejectedValue(new Error("No app handles this URL"));
    api.reply(PATH, { meeting: meeting({ attendance: "hybrid", conferencePhone: "+1 646 558 8656" }) });
    await renderApp(`/meeting/${ID}`);
    expect(screen.queryByText(/couldn't/)).toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Dial in" }));
    expect(
      await screen.findByText("This phone couldn't start a call. The number is shown above."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Directions" }));
    expect(await screen.findByText("This phone couldn't open Maps.")).toBeOnTheScreen();
  });

  it("says the tag names are still to come when none have loaded", async () => {
    // The tag list can't be read (no saved copy either), so no slug has a name to show.
    api.reply(
      "/api/v2/vocabulary",
      { error: { code: "server_error", message: "Something went wrong." } },
      500,
    );
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    await waitFor(() => {
      expect(api.requests.some((r) => r.path === "/api/v2/vocabulary")).toBe(true);
    });
    expect(
      await screen.findByText("Tag names haven't loaded yet. They'll appear when you're back online."),
    ).toBeOnTheScreen();
    expect(screen.queryByText("No one has tagged this meeting yet.")).toBeNull();
  });

  it("never opens a link that isn't a web address", async () => {
    // WebUrl allows only http and https, so the whole answer is refused rather than shown.
    api.reply(PATH, {
      meeting: { ...meeting({ attendance: "online" }), conferenceUrl: "javascript:alert(1)" },
    });
    await renderApp(`/meeting/${ID}`);
    expect(
      await screen.findByText(
        "We couldn't reach My Meeting App, and this isn't saved on your phone yet. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Join online" })).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });

  it("follows a merged meeting to its new id, moving its saved copy, the phone's tag record and its attendance results", async () => {
    api.reply(PATH, { meeting: meeting({ id: SURVIVOR, name: "Nooners (merged)" }) });
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-10-05T17:00:00Z"));
    await recordNear(ID, new Date("2026-10-05T17:00:00Z"));
    // The survivor already had a result of its own, still inside its tagging window: both are kept, once each.
    await recordNear(SURVIVOR, new Date("2026-10-04T17:00:00Z"));
    // Launch prunes results whose tagging window has closed, so the clock is set rather than left at today's.
    setNow("2026-10-05T19:00:00Z");
    const app = await renderApp(`/meeting/${ID}`);
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
    });
    expect(await screen.findByText("Nooners (merged)")).toBeOnTheScreen();
    expect(await readCache(`meeting:${ID}`)).toBeNull();
    expect(await readCache(`meeting:${SURVIVOR}`)).not.toBeNull();
    expect(await myTagsOn(SURVIVOR)).toMatchObject({ tags: ["quiet"] });
    expect(await myTagsOn(ID)).toBeNull();
    expect(await wasNear(SURVIVOR, new Date("2026-10-05T17:00:00Z"))).toBe(true);
    expect(await wasNear(SURVIVOR, new Date("2026-10-04T17:00:00Z"))).toBe(true);
    expect(await wasNear(ID, new Date("2026-10-05T17:00:00Z"))).toBe(false);
    // The moved copy is fresh, so the new id isn't asked for again, and the old one only once.
    expect(meetingRequests().map((r) => r.path)).toEqual([PATH]);
  });

  it("keeps its saved copy for the next visit within the reuse window", async () => {
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText(WHEN)).toBeOnTheScreen();
    await cleanup();
    api.reply(PATH, { error: { code: "server_error", message: "Something went wrong." } }, 500);
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText(WHEN)).toBeOnTheScreen();
    // The tag list is read at every launch; its labels arriving means this launch's reads have landed.
    expect(await screen.findByLabelText("Welcoming 14 people")).toBeOnTheScreen();
    expect(meetingRequests()).toHaveLength(1);
  });

  it("still follows a merged meeting when its saved copy can't be moved", async () => {
    const db = await appDatabase();
    jest.spyOn(db, "withTransactionAsync").mockRejectedValueOnce(new Error("disk full"));
    api.reply(PATH, { meeting: meeting({ id: SURVIVOR, name: "Nooners (merged)" }) });
    api.reply(`/api/v1/meetings/${SURVIVOR}`, {
      meeting: meeting({ id: SURVIVOR, name: "Nooners (merged)" }),
    });
    const app = await renderApp(`/meeting/${ID}`);
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
    });
    expect(await screen.findByText("Nooners (merged)")).toBeOnTheScreen();
  });

  it("passes on the server's words for a meeting that's gone, even with an old copy saved", async () => {
    setNow("2026-10-05T20:00:00Z");
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    setNow("2026-10-05T21:30:00Z");
    api.reply(
      PATH,
      {
        error: {
          code: "meeting_not_found",
          message: "We couldn't find that meeting. It may have been removed from the meeting list.",
        },
      },
      404,
    );
    await renderApp(`/meeting/${ID}`);
    expect(
      await screen.findByText(
        "We couldn't find that meeting. It may have been removed from the meeting list.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Nooners")).toBeNull();
  });

  it("labels an old saved copy shown offline", async () => {
    setNow("2026-10-05T20:00:00Z");
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    setNow("2026-10-05T21:30:00Z");
    // No reply for the meeting: the test server answers 599, which the app treats as unreachable.
    await renderApp(`/meeting/${ID}`);
    expect(
      await screen.findByText(
        "Showing the copy saved today at 3:00 PM. We couldn't reach My Meeting App, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(WHEN)).toBeOnTheScreen();
  });

  it("reads again on returning to the app after its reuse window", async () => {
    const tell = spyOnAppState();
    setNow("2026-10-05T20:00:00Z");
    api.reply(PATH, { meeting: meeting() });
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText("Nooners")).toBeOnTheScreen();
    api.reply(PATH, { meeting: meeting({ name: "Nooners (renamed)" }) });
    setNow("2026-10-05T21:01:00Z");
    await tell("background");
    await tell("active");
    expect(await screen.findByText("Nooners (renamed)")).toBeOnTheScreen();
  });

  it("says a link with no meeting id in it isn't valid, without asking the server", async () => {
    await renderApp("/meeting/not-a-meeting");
    expect(await screen.findByText("That meeting link isn't valid.")).toBeOnTheScreen();
    expect(meetingRequests()).toEqual([]);
  });
});

describe("the meeting page at large text sizes", () => {
  beforeEach(() => {
    api.reply(PATH, { meeting: meeting({ name: "Spiritual Progress" }) });
  });

  // 1.35 is iOS's largest standard size, the last one before the accessibility sizes.
  it.each([1, 1.35])("keeps Save beside the title at the standard sizes (%p)", async (fontScale) => {
    setFontScale(fontScale);
    await renderApp(`/meeting/${ID}`);
    const title = await screen.findByRole("header", { name: "Spiritual Progress" });
    const around = title.parent;
    if (!around) throw new Error("the title has nothing around it");
    expect(around).toHaveStyle({ flexDirection: "row" });
    // The heart waits for the phone to say whether the meeting is saved, which can land after the title.
    expect(await within(around).findByRole("button", { name: "Save" })).toBeOnTheScreen();
  });

  // Beside it, the heart took a column on the right and the title broke mid-word: "Spi / ritu / al".
  it("puts Save under the title at the accessibility sizes, so the title has the whole width", async () => {
    setFontScale(LARGEST_TEXT);
    await renderApp(`/meeting/${ID}`);
    const title = await screen.findByRole("header", { name: "Spiritual Progress" });
    const around = title.parent;
    if (!around) throw new Error("the title has nothing around it");
    expect(around).toHaveStyle({ flexDirection: "column" });
    expect(await within(around).findByRole("button", { name: "Save" })).toBeOnTheScreen();
  });

  // At 3.12 times, one long word is wider than the phone; twice the size still fits one.
  it("lets the title grow to twice its size and no further", async () => {
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByRole("header", { name: "Spiritual Progress" })).toHaveProp(
      "maxFontSizeMultiplier",
      2,
    );
  });
});
