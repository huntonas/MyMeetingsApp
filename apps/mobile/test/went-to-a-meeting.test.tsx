import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { recordSubmission } from "@/tagging/my-tags";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, nearbyMeeting, VOCABULARY } from "./fixtures";
import { setPlace } from "./native/native-location";
import { launchNearby } from "./render-app";

// Owner decision, 2026-10-04: right after a meeting, Nearby's starting list has moved on from it, so the list offers
// the meetings nearby whose tagging window is open, the latest first, worked out on the phone from the search's answer.

let api: TestApi;
const SEARCH = "/api/v1/meetings/search";
const HEADING = "Went to a meeting? Tag it";

// Wednesday 7 October 2026, 10:17 PM in Chicago, the suite's zone and the fixtures'.
const WEDNESDAY_LATE = "2026-10-08T03:17:00Z";

const at = (n: number) => ({ latitude: 35.7565 + n / 1000, longitude: -83.9705 });
const wednesdayEvening = nearbyMeeting({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Wednesday Evening Group",
  day: 3,
  time: "19:00",
  endTime: "20:00",
  ...at(1),
});
// Began an hour and 17 minutes ago: over, and gone from the starting list.
const wednesdayLate = nearbyMeeting({
  id: "22222222-2222-4222-8222-222222222222",
  name: "Wednesday Late Group",
  day: 3,
  time: "21:00",
  endTime: "22:00",
  ...at(2),
});
const tuesdayNight = nearbyMeeting({
  id: "33333333-3333-4333-8333-333333333333",
  name: "Tuesday Night Group",
  day: 2,
  time: "20:00",
  ...at(3),
});
// 35 hours and 17 minutes ago: its window is still open.
const tuesdayMorning = nearbyMeeting({
  id: "44444444-4444-4444-8444-444444444444",
  name: "Tuesday Morning Group",
  day: 2,
  time: "11:00",
  ...at(4),
});
// 36 hours and 17 minutes ago: its window has closed.
const tuesdayEarly = nearbyMeeting({
  id: "55555555-5555-4555-8555-555555555555",
  name: "Tuesday Early Group",
  day: 2,
  time: "10:00",
  ...at(5),
});
const thursday = nearbyMeeting({
  id: "66666666-6666-4666-8666-666666666666",
  name: "Thursday Group",
  day: 4,
  time: "07:00",
  ...at(6),
});
const NAMES = [
  "Wednesday Evening Group",
  "Wednesday Late Group",
  "Tuesday Night Group",
  "Tuesday Morning Group",
  "Tuesday Early Group",
  "Thursday Group",
  "Tomorrow",
  HEADING,
];

// The texts on screen that are among NAMES (and any `more`), in the order they're shown.
const shownInOrder = (more: string[] = []) =>
  screen
    .queryAllByText(
      new RegExp(`^(${[...NAMES, ...more].map((name) => name.replace("?", "\\?")).join("|")})$`),
    )
    .map((element) => String(element.props.children));

beforeEach(async () => {
  setNow(WEDNESDAY_LATE);
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v2/vocabulary", VOCABULARY);
  setPlace("Maryville, TN", at(0));
});
afterEach(async () => {
  await api.close();
});

async function searchWith(meetings: (typeof thursday)[]) {
  api.reply(SEARCH, { meetings });
  await launchNearby();
  await fireEvent.changeText(await screen.findByLabelText("Search for a place"), "Maryville, TN");
  await fireEvent.press(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Thursday Group");
}

describe("Went to a meeting? Tag it", () => {
  it("lists the meetings nearby whose tagging window is open, the latest start first, above the starting list", async () => {
    await searchWith([thursday, tuesdayEarly, tuesdayNight, wednesdayEvening, wednesdayLate]);
    expect(await screen.findByRole("header", { name: HEADING })).toBeOnTheScreen();
    expect(shownInOrder()).toEqual([
      HEADING,
      "Wednesday Late Group",
      "Wednesday Evening Group",
      "Tomorrow",
      "Thursday Group",
    ]);
    expect(screen.getByText("Started in the last 36 hours.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Wednesday Late Group, Wed 9:00 PM, / })).toHaveProp(
      "accessibilityHint",
      "Opens the meeting's details",
    );
    // Worked out from the search the list already made: nothing more is asked of the server.
    expect(api.requests.map((request) => request.path).sort()).toEqual([
      "/api/v1/config",
      SEARCH,
      "/api/v2/vocabulary",
    ]);
  });

  it("puts the nearest first among meetings that started at the same time", async () => {
    const annex = {
      ...wednesdayLate,
      id: "77777777-7777-4777-8777-777777777777",
      name: "Annex Group",
      ...at(9),
    };
    await searchWith([thursday, annex, wednesdayLate]);
    await screen.findByRole("header", { name: HEADING });
    expect(shownInOrder(["Annex Group"]).slice(0, 3)).toEqual([
      HEADING,
      "Wednesday Late Group",
      "Annex Group",
    ]);
  });

  // Two, so tonight's meetings still start on the first screen (owner ruling, 2026-10-04).
  it("shows the latest two, and the rest on request", async () => {
    await searchWith([thursday, tuesdayMorning, tuesdayNight, wednesdayEvening, wednesdayLate]);
    await screen.findByRole("header", { name: HEADING });
    expect(screen.queryByText("Tuesday Night Group")).toBeNull();
    expect(screen.queryByText("Tuesday Morning Group")).toBeNull();
    const more = screen.getByRole("button", { name: "Show 2 more" });
    expect(more).toHaveProp("accessibilityHint", "Lists every meeting nearby you can tag now");
    await fireEvent.press(more);
    expect(shownInOrder()).toEqual([
      HEADING,
      "Wednesday Late Group",
      "Wednesday Evening Group",
      "Tuesday Night Group",
      "Tuesday Morning Group",
      "Tomorrow",
      "Thursday Group",
    ]);
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer).toHaveProp("accessibilityHint", "Lists only the latest two");
    await fireEvent.press(fewer);
    expect(screen.queryByText("Tuesday Night Group")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 2 more" })).toBeOnTheScreen();
  });

  it("leaves out what the meeting's page wouldn't offer to tag: tagged from this phone this week, opted out, or with no time zone", async () => {
    await recordSubmission(wednesdayLate, ["quiet"], new Date("2026-10-08T03:00:00Z"));
    // Last week's tagging still counts for a week, as the server's one-a-week rule does.
    await recordSubmission(tuesdayNight, ["quiet"], new Date("2026-10-01T12:00:00Z"));
    await searchWith([
      thursday,
      tuesdayNight,
      wednesdayLate,
      { ...wednesdayEvening, tagsDisabled: true, tags: [] },
      { ...tuesdayMorning, timezone: null },
    ]);
    await waitFor(() => {
      expect(screen.queryByRole("header", { name: HEADING })).toBeNull();
    });
    expect(shownInOrder()).toEqual(["Tomorrow", "Thursday Group"]);
  });

  it("shows nothing while tagging is switched off", async () => {
    api.reply("/api/v1/config", { ...CONFIG, features: { tagging: false, suggestions: true } });
    await searchWith([thursday, wednesdayLate]);
    expect(screen.queryByRole("header", { name: HEADING })).toBeNull();
    expect(screen.queryByText("Wednesday Late Group")).toBeNull();
  });

  it("shows only while the filters are the starting ones, and never on the map", async () => {
    await searchWith([thursday, wednesdayLate]);
    await screen.findByRole("header", { name: HEADING });
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    expect(screen.queryByRole("header", { name: HEADING })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "List" }));
    await screen.findByRole("header", { name: HEADING });
    // Clear lists every meeting, this one among them.
    await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(screen.queryByRole("header", { name: HEADING })).toBeNull();
    });
    expect(screen.getAllByText("Wednesday Late Group")).toHaveLength(1);
  });

  it("opens the meeting's page to tag it, and leaves it out once tagged", async () => {
    const { id, ...rest } = wednesdayLate;
    api.reply(`/api/v1/meetings/${id}`, { meeting: meeting({ ...rest, id }) });
    api.reply("/api/v1/tags", { meetingId: id, tags: [{ slug: "quiet", count: 1 }] }, 201, "POST");
    await searchWith([thursday, wednesdayLate]);
    await fireEvent.press(await screen.findByRole("button", { name: /^Wednesday Late Group, / }));
    await fireEvent.press(await screen.findByRole("button", { name: "Tag this meeting" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Quiet" }));
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    expect(await screen.findByText("Thanks. Your tags are added.")).toBeOnTheScreen();
    await act(() => {
      router.back();
    });
    await screen.findByText("Thursday Group");
    await waitFor(() => {
      expect(screen.queryByRole("header", { name: HEADING })).toBeNull();
    });
    expect(screen.queryByText("Wednesday Late Group")).toBeNull();
  });
});
