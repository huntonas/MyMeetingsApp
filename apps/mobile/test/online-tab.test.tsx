import type { MeetingSummary } from "@mymeetingapp/shared";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { writeCache } from "@/cache/store";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { renderApp } from "./render-app";

const NOW = "2026-10-05T23:30:00Z"; // Monday 6:30 PM on the phone (America/Chicago)

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  setNow(NOW);
});
afterEach(async () => {
  await api.close();
});

const online = (id: string, change: Partial<MeetingSummary>) =>
  meeting({ id, attendance: "online", conferenceUrl: "https://zoom.us/j/1", locationName: null, ...change });

const EARLY_EVENING = online("11111111-1111-4111-8111-111111111111", {
  name: "Early Evening",
  day: 1,
  time: "18:00",
  endTime: "19:00",
});

// The phone's yesterday, today and tomorrow: a meeting's own weekday can differ from the phone's by one.
function replyDays(monday: MeetingSummary[]) {
  api.reply("/api/v1/meetings/online?day=0", { meetings: [] });
  api.reply("/api/v1/meetings/online?day=1", { meetings: monday });
  api.reply("/api/v1/meetings/online?day=2", { meetings: [] });
}

const onlineRequests = () => api.requests.filter((r) => r.path.startsWith("/api/v1/meetings/online")).length;
const vocabularyRequests = () => api.requests.filter((r) => r.path === "/api/v1/vocabulary").length;

const NOTHING_ON = "No online meetings are happening right now.";

describe("the Online tab", () => {
  it("shows what's happening now and soon, in the phone's local time", async () => {
    replyDays([
      EARLY_EVENING,
      online("22222222-2222-4222-8222-222222222222", {
        name: "East Coast Speakers",
        day: 1,
        time: "19:30",
        endTime: "20:30",
        timezone: "America/New_York",
      }),
      online("33333333-3333-4333-8333-333333333333", {
        name: "Night Owls",
        day: 1,
        time: "20:00",
        endTime: null,
      }),
      online("44444444-4444-4444-8444-444444444444", {
        name: "Late Book Study",
        day: 1,
        time: "21:00",
        endTime: null,
      }),
    ]);
    await renderApp("/online");
    const now = within(await screen.findByLabelText("Happening now"));
    expect(now.getByRole("button", { name: "Early Evening, Started 6:00 PM" })).toBeOnTheScreen();
    // 7:30 PM in New York is 6:30 PM on the phone.
    expect(now.getByRole("button", { name: "East Coast Speakers, Started 6:30 PM" })).toBeOnTheScreen();
    const soon = within(screen.getByLabelText("Starting in the next 2 hours"));
    expect(soon.getByRole("button", { name: "Night Owls, Starts 8:00 PM" })).toBeOnTheScreen();
    expect(soon.queryByText("Early Evening")).toBeNull();
    expect(screen.queryByText("Late Book Study")).toBeNull();
    expect(screen.queryByText(NOTHING_ON)).toBeNull();
  });

  it("reads the phone's yesterday for a meeting still on its own previous day", async () => {
    // Sunday 10:45 PM in Los Angeles is already Monday 12:45 AM on the phone.
    setNow("2026-10-05T05:45:00Z");
    api.reply("/api/v1/meetings/online?day=0", {
      meetings: [
        online("66666666-6666-4666-8666-666666666666", {
          name: "West Coast Late",
          day: 0,
          time: "22:30",
          endTime: "23:30",
          timezone: "America/Los_Angeles",
        }),
      ],
    });
    api.reply("/api/v1/meetings/online?day=1", { meetings: [] });
    api.reply("/api/v1/meetings/online?day=2", { meetings: [] });
    await renderApp("/online");
    const now = within(await screen.findByLabelText("Happening now"));
    expect(now.getByRole("button", { name: "West Coast Late, Started 12:30 AM" })).toBeOnTheScreen();
  });

  it("reads the phone's tomorrow for a meeting already on its own next day", async () => {
    // Tuesday 12:15 AM in New York is still Monday 11:15 PM on the phone.
    setNow("2026-10-06T04:00:00Z");
    api.reply("/api/v1/meetings/online?day=0", { meetings: [] });
    api.reply("/api/v1/meetings/online?day=1", { meetings: [] });
    api.reply("/api/v1/meetings/online?day=2", {
      meetings: [
        online("55555555-5555-4555-8555-555555555555", {
          name: "Midnight Oil",
          day: 2,
          time: "00:15",
          endTime: null,
          timezone: "America/New_York",
        }),
      ],
    });
    await renderApp("/online");
    const soon = within(await screen.findByLabelText("Starting in the next 2 hours"));
    expect(soon.getByRole("button", { name: "Midnight Oil, Starts 11:15 PM" })).toBeOnTheScreen();
  });

  it("shows each card's top three tags, with labels from the tag list", async () => {
    replyDays([
      {
        ...EARLY_EVENING,
        tags: [
          { slug: "welcoming", count: 14 },
          { slug: "quiet", count: 1 },
          { slug: "brand-new-tag", count: 5 },
          { slug: "coffee", count: 3 },
        ],
      },
    ]);
    await renderApp("/online");
    expect(await screen.findByLabelText("Welcoming, 14 people")).toBeOnTheScreen();
    expect(screen.getByText("Welcoming 14")).toBeOnTheScreen();
    expect(screen.getByLabelText("Quiet, 1 person")).toBeOnTheScreen();
    // A slug the phone has no label for yet waits for the next tag-list read instead of showing raw.
    expect(screen.queryByText(/brand-new-tag/)).toBeNull();
    expect(screen.queryByLabelText("Coffee, 3 people")).toBeNull();
  });

  // The meeting page arrives in Task 10, which pins the exact path; until then a tap reaches expo-router's
  // unmatched-route screen, which proves the card navigates away from the tab.
  it("leaves the tab for the meeting's page when its card is tapped", async () => {
    replyDays([EARLY_EVENING]);
    await renderApp("/online");
    await fireEvent.press(await screen.findByRole("button", { name: "Early Evening, Started 6:00 PM" }));
    expect(await screen.findByText("Unmatched Route")).toBeOnTheScreen();
  });

  it("says so when nothing is on", async () => {
    replyDays([]);
    await renderApp("/online");
    expect(await screen.findByText(NOTHING_ON)).toBeOnTheScreen();
  });

  it("says why when it can't get the list and has no saved copy", async () => {
    await renderApp("/online");
    expect(
      await screen.findByText(
        "We couldn't reach mymeetingapp, and there's no saved copy on this phone yet. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(NOTHING_ON)).toBeNull();
  });

  it("shows the saved copies, and says when the oldest was saved, when the server is having trouble", async () => {
    const serverError = { error: { code: "server_error", message: "message" } };
    setNow("2026-10-05T22:00:00Z");
    await writeCache("online:2", { meetings: [] });
    setNow("2026-10-05T20:40:00Z");
    await writeCache("online:1", { meetings: [EARLY_EVENING] });
    setNow(NOW);
    api.reply("/api/v1/meetings/online?day=0", { meetings: [] });
    api.reply("/api/v1/meetings/online?day=1", serverError, 500);
    api.reply("/api/v1/meetings/online?day=2", serverError, 500);
    await renderApp("/online");
    expect(await screen.findByRole("button", { name: "Early Evening, Started 6:00 PM" })).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Showing the copy saved today at 3:40 PM. mymeetingapp is having trouble right now, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
  });

  it("asks again each time the tab comes back into view", async () => {
    replyDays([]);
    await renderApp("/online");
    await screen.findByText(NOTHING_ON);
    // The list shows only once all three days have answered, so nothing else is on its way.
    expect(onlineRequests()).toBe(3);
    replyDays([EARLY_EVENING]);
    await fireEvent.press(screen.getByLabelText("Me"));
    await fireEvent.press(await screen.findByLabelText("Online"));
    expect(await screen.findByRole("button", { name: "Early Evening, Started 6:00 PM" })).toBeOnTheScreen();
    await waitFor(() => {
      expect(onlineRequests()).toBe(6);
    });
  });

  it("reads the tag list again when the app returns to the foreground", async () => {
    const listeners: ((state: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      listeners.push(listener);
      return { remove: () => undefined };
    });
    replyDays([EARLY_EVENING]);
    await renderApp("/online");
    await screen.findByLabelText("Welcoming, 14 people");
    expect(vocabularyRequests()).toBe(1);
    api.reply("/api/v1/vocabulary", {
      tags: VOCABULARY.tags.map((tag) =>
        tag.slug === "welcoming" ? { ...tag, label: "Warm welcome" } : tag,
      ),
    });
    const tell = async (state: AppStateStatus) => {
      await act(() => {
        for (const listener of listeners) listener(state);
      });
    };
    await tell("background");
    await tell("active");
    expect(await screen.findByLabelText("Warm welcome, 14 people")).toBeOnTheScreen();
    // Going to the background asked for nothing; only the return did.
    expect(vocabularyRequests()).toBe(2);
  });
});
