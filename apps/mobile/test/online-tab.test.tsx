import type { MeetingSummary } from "@mymeetingapp/shared";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { writeCache } from "@/cache/store";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CLOCK_AND_INTERVALS, setNow } from "./clock";
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

// Every fixture meeting carries the fixture's one tag, which its card reads out after its name and time.
const WELCOMING = "Welcoming 14 people";

const EARLY_EVENING = online("11111111-1111-4111-8111-111111111111", {
  name: "Early Evening",
  day: 1,
  time: "18:00",
  endTime: "19:00",
});
const NIGHT_OWLS = online("33333333-3333-4333-8333-333333333333", {
  name: "Night Owls",
  day: 1,
  time: "20:00",
  endTime: null,
});

function replyDay(day: number, meetings: MeetingSummary[]) {
  api.reply(`/api/v1/meetings/online?day=${String(day)}`, { meetings });
}

// The phone's yesterday, today and tomorrow: a meeting's own weekday can differ from the phone's by one.
function replyDays(monday: MeetingSummary[]) {
  replyDay(0, []);
  replyDay(1, monday);
  replyDay(2, []);
}

const card = (name: string) => screen.findByRole("button", { name });
const header = (name: string) => screen.queryByRole("header", { name });
const onlineRequests = () => api.requests.filter((r) => r.path.startsWith("/api/v1/meetings/online")).length;
const vocabularyRequests = () => api.requests.filter((r) => r.path === "/api/v1/vocabulary").length;

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
      NIGHT_OWLS,
      online("44444444-4444-4444-8444-444444444444", {
        name: "Late Book Study",
        day: 1,
        time: "21:00",
        endTime: null,
      }),
    ]);
    await renderApp("/online");
    expect(await card(`Early Evening, Started 6:00 PM, ${WELCOMING}`)).toBeOnTheScreen();
    // 7:30 PM in New York is 6:30 PM on the phone.
    expect(await card(`East Coast Speakers, Started 6:30 PM, ${WELCOMING}`)).toBeOnTheScreen();
    expect(await card(`Night Owls, Starts 8:00 PM, ${WELCOMING}`)).toBeOnTheScreen();
    expect(header("Happening now")).toBeOnTheScreen();
    expect(header("Starting in the next 2 hours")).toBeOnTheScreen();
    expect(screen.queryByText("Late Book Study")).toBeNull();
    expect(screen.queryByText(NOTHING_ON)).toBeNull();
  });

  it("reads the phone's tomorrow across the end of the week", async () => {
    setNow("2026-10-11T04:30:00Z"); // Saturday 11:30 PM on the phone
    replyDay(5, []);
    replyDay(6, []);
    replyDay(0, [
      online("55555555-5555-4555-8555-555555555555", { name: "Sunday Sunrise", day: 0, time: "00:30" }),
    ]);
    await renderApp("/online");
    expect(await card(`Sunday Sunrise, Starts 12:30 AM, ${WELCOMING}`)).toBeOnTheScreen();
    expect(header("Starting in the next 2 hours")).toBeOnTheScreen();
    expect(header("Happening now")).toBeNull();
  });

  it("reads the phone's yesterday across the start of the week", async () => {
    setNow("2026-10-11T05:15:00Z"); // Sunday 12:15 AM on the phone
    replyDay(6, [
      online("66666666-6666-4666-8666-666666666666", {
        name: "Saturday Late",
        day: 6,
        time: "23:30",
        endTime: "00:30",
      }),
    ]);
    replyDay(0, []);
    replyDay(1, []);
    await renderApp("/online");
    expect(await card(`Saturday Late, Started 11:30 PM, ${WELCOMING}`)).toBeOnTheScreen();
    expect(header("Happening now")).toBeOnTheScreen();
    expect(header("Starting in the next 2 hours")).toBeNull();
  });

  it("shows and reads out each card's top three tags the phone has labels for", async () => {
    replyDays([
      {
        ...EARLY_EVENING,
        tags: [
          { slug: "welcoming", count: 14 },
          { slug: "quiet", count: 1 },
          { slug: "brand-new-tag", count: 5 },
          { slug: "coffee", count: 3 },
          { slug: "lively", count: 2 },
        ],
      },
    ]);
    await renderApp("/online");
    // A slug the phone has no label for yet waits for the next tag-list read instead of showing raw, and doesn't
    // take one of the three places.
    expect(
      await card("Early Evening, Started 6:00 PM, Welcoming 14 people, Quiet 1 person, Coffee 3 people"),
    ).toBeOnTheScreen();
    // The chips are read out as part of the card, not one by one.
    expect(screen.queryByText("Welcoming 14")).toBeNull();
    const shown = { includeHiddenElements: true };
    expect(screen.getByText("Welcoming 14", shown)).toBeOnTheScreen();
    expect(screen.getByText("14", shown)).toHaveStyle({ fontFamily: "AtkinsonHyperlegible-Bold" });
    expect(screen.getByText("Coffee 3", shown)).toBeOnTheScreen();
    expect(screen.queryByText(/brand-new-tag/, shown)).toBeNull();
    expect(screen.queryByText("Lively 2", shown)).toBeNull();
  });

  it("leaves the tab for the meeting's page when its card is tapped", async () => {
    replyDays([EARLY_EVENING]);
    api.reply(`/api/v1/meetings/${EARLY_EVENING.id}`, { meeting: EARLY_EVENING });
    const app = await renderApp("/online");
    await fireEvent.press(await card(`Early Evening, Started 6:00 PM, ${WELCOMING}`));
    await waitFor(() => {
      expect(app.getPathname()).toBe("/meeting/11111111-1111-4111-8111-111111111111");
    });
    expect(await screen.findByText("Mondays, 6:00 PM to 7:00 PM")).toBeOnTheScreen();
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
    replyDay(0, []);
    api.reply("/api/v1/meetings/online?day=1", serverError, 500);
    api.reply("/api/v1/meetings/online?day=2", serverError, 500);
    await renderApp("/online");
    expect(await card(`Early Evening, Started 6:00 PM, ${WELCOMING}`)).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Showing the copy saved today at 3:40 PM. mymeetingapp is having trouble right now, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
  });

  it("asks again, and moves on to the current time, each time the tab comes back into view", async () => {
    replyDays([EARLY_EVENING]);
    await renderApp("/online");
    await card(`Early Evening, Started 6:00 PM, ${WELCOMING}`);
    // The list shows only once all three days have answered, so nothing else is on its way.
    expect(onlineRequests()).toBe(3);
    replyDays([EARLY_EVENING, NIGHT_OWLS]);
    await fireEvent.press(screen.getByLabelText("Me"));
    setNow("2026-10-06T00:15:00Z"); // 7:15 PM: Early Evening is over
    await fireEvent.press(await screen.findByLabelText("Online"));
    expect(await card(`Night Owls, Starts 8:00 PM, ${WELCOMING}`)).toBeOnTheScreen();
    expect(screen.queryByText("Early Evening")).toBeNull();
    await waitFor(() => {
      expect(onlineRequests()).toBe(6);
    });
  });

  it("asks again, and moves on to the current time, when the app returns from the background", async () => {
    const tell = spyOnAppState();
    replyDays([EARLY_EVENING, NIGHT_OWLS]);
    await renderApp("/online");
    expect(await card(`Early Evening, Started 6:00 PM, ${WELCOMING}`)).toBeOnTheScreen();
    await tell("background");
    setNow("2026-10-06T00:30:00Z"); // 7:30 PM: Early Evening is over
    await tell("active");
    await waitFor(() => {
      expect(onlineRequests()).toBe(6);
    });
    await waitFor(() => {
      expect(screen.queryByText("Early Evening")).toBeNull();
    });
    expect(await card(`Night Owls, Starts 8:00 PM, ${WELCOMING}`)).toBeOnTheScreen();
    expect(header("Happening now")).toBeNull();
  });

  it("moves on each minute while the tab is in view", async () => {
    replyDays([{ ...EARLY_EVENING, endTime: "18:31" }]);
    await renderApp("/online");
    await card(`Early Evening, Started 6:00 PM, ${WELCOMING}`);
    await fireEvent.press(screen.getByLabelText("Me"));
    // The tick starts each time the tab comes into view, so it's brought back into view on a clock whose intervals
    // are fake too. RNTL's waits poll with setInterval, so nothing waits until the clock is back to CLOCK_ONLY.
    jest.useFakeTimers({ ...CLOCK_AND_INTERVALS, now: Date.now() });
    replyDays([{ ...EARLY_EVENING, endTime: "18:31" }, NIGHT_OWLS]);
    await fireEvent.press(screen.getByLabelText("Online"));
    expect(screen.getByText("Early Evening")).toBeOnTheScreen();
    await act(() => {
      jest.advanceTimersByTime(60_000); // 6:31 PM: Early Evening has just ended
    });
    expect(screen.queryByText("Early Evening")).toBeNull();
    // Let the read that coming into view started land before the test ends.
    setNow(new Date(Date.now()).toISOString());
    expect(await card(`Night Owls, Starts 8:00 PM, ${WELCOMING}`)).toBeOnTheScreen();
    expect(screen.queryByText("Early Evening")).toBeNull();
  });

  it("reads the tag list again only when the app returns from the background", async () => {
    const tell = spyOnAppState();
    replyDays([EARLY_EVENING]);
    await renderApp("/online");
    await card(`Early Evening, Started 6:00 PM, ${WELCOMING}`);
    expect(vocabularyRequests()).toBe(1);
    api.reply("/api/v1/vocabulary", {
      tags: VOCABULARY.tags.map((tag) =>
        tag.slug === "welcoming" ? { ...tag, label: "Warm welcome" } : tag,
      ),
    });
    // A notification banner or the app switcher makes the app inactive without leaving it.
    await tell("inactive");
    await tell("active");
    await tell("background");
    await tell("active");
    expect(await card("Early Evening, Started 6:00 PM, Warm welcome 14 people")).toBeOnTheScreen();
    expect(vocabularyRequests()).toBe(2);
  });
});
