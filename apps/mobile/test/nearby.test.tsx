import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, type AppStateStatus, Linking } from "react-native";

import { readCache } from "@/cache/store";
import { appDatabase } from "@/db/database";
import { recentPlaces } from "@/location/recent-places";
import * as schedule from "@/meetings/schedule";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, nearbyMeeting, VOCABULARY } from "./fixtures";
import { later } from "./later";
import {
  permissionRequests,
  positionOptions,
  positionsDelivered,
  setDevicePosition,
  setLocationPermission,
  setPermissionAnswer,
} from "./native/expo-location";
import { answered, lookups, setPlace } from "./native/native-location";
import { launchNearby, renderApp } from "./render-app";

let api: TestApi;
const SEARCH = "/api/v1/meetings/search";
const searches = () => api.requests.filter((request) => request.path === SEARCH);
const searchBodies = () =>
  searches().map((request) => {
    const body: unknown = JSON.parse(request.body);
    return body;
  });
const recentLabels = async () => (await recentPlaces()).map((place) => place.label);

const PROMPT = "Search by city, zip code or address, or use your location.";
const MARYVILLE = { latitude: 35.7565, longitude: -83.9705 };

const far = nearbyMeeting({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Far Group",
  day: 1,
  time: "19:00",
  latitude: 35.77,
  longitude: -83.99,
  distanceKm: 0.9,
});
const near = nearbyMeeting({
  id: "22222222-2222-4222-8222-222222222222",
  name: "Near Group",
  day: 1,
  time: "08:00",
  latitude: 35.7566,
  longitude: -83.9706,
  distanceKm: 1.6,
  tags: [{ slug: "quiet", count: 2 }],
});

// Filters start as today, from now on: early on a Monday morning (Chicago, the suite's zone), every Monday meeting from
// then on is in view. A test about other days or times sets its own.
const MONDAY_EARLY_MORNING = "2026-10-05T10:30:00Z";

beforeEach(async () => {
  setNow(MONDAY_EARLY_MORNING);
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  setPlace("Maryville, TN", MARYVILLE);
});
afterEach(async () => {
  await api.close();
});

async function searchFor(text: string) {
  await fireEvent.changeText(await screen.findByLabelText("Search for a place"), text);
  await fireEvent.press(screen.getByRole("button", { name: "Search" }));
}

const filtersToggle = () => screen.getByRole("button", { name: /^Filters/ });

// Opens the filters panel, unless it's open already.
async function openFilters() {
  await screen.findByRole("button", { name: /^Filters/ });
  const closed = screen.queryByRole("button", { name: /^Filters/, expanded: false });
  if (closed !== null) await fireEvent.press(closed);
}

const UNCHOSEN = ["Day filters", "Time filters", "Type filters", "Tag filters"];
async function expectNoFiltersChosen() {
  await openFilters();
  for (const name of UNCHOSEN) expect(screen.getByRole("button", { name })).toBeOnTheScreen();
}

async function chooseFilters(pill: string, choices: string[]) {
  await openFilters();
  await fireEvent.press(await screen.findByRole("button", { name: pill }));
  for (const choice of choices) await fireEvent.press(await screen.findByRole("checkbox", { name: choice }));
  await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
}

// The texts on screen that are among `names` (plain words, no pattern characters), in the order they're shown.
const shownInOrder = (names: string[]) =>
  screen
    .queryAllByText(new RegExp(`^(${names.join("|")})$`))
    .map((element) => String(element.props.children));

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

describe("Nearby without location", () => {
  it("asks for nothing at launch", async () => {
    await launchNearby();
    expect(screen.getByText(PROMPT)).toBeOnTheScreen();
    expect(permissionRequests()).toBe(0);
    expect(positionOptions()).toEqual([]);
    expect(searches()).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Spec §2 and the privacy page: typed text goes to the platform geocoder (Apple's, Google's or, on some Android
  // phones, the phone maker's), never to us; it doesn't stay on the phone.
  it("says truthfully where typed text and location go", async () => {
    await launchNearby();
    expect(
      screen.getByText(
        "What you type goes only to Apple's or Google's map service, or on some Android phones the phone maker's, to find the place, never to us. Your exact location stays on this phone; a search sends us only a point rounded to about 1 km.",
      ),
    ).toBeOnTheScreen();
  });

  it("finds a typed place on the phone, sends only the rounded point, and sorts by exact distance", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    const cards = await screen.findAllByRole("button", { name: /Group, Mon/ });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAccessibleName(
      "Near Group, Mon 8:00 AM, under 0.1 mi, St. Luke's, Quiet 2 people",
    );
    expect(cards[1]).toHaveAccessibleName("Far Group, Mon 7:00 PM, 1.4 mi, St. Luke's, Welcoming 14 people");
    expect(screen.getByText("2 meetings · today from now")).toBeOnTheScreen();
    expect(lookups).toEqual(["Maryville, TN"]);
    expect(searchBodies()).toEqual([{ lat: 35.76, lng: -83.97, radiusKm: 25 }]);
    for (const request of api.requests) {
      expect(`${request.path} ${request.body}`).not.toMatch(/maryville|35\.756|83\.970/i);
    }
    // The saved copy is keyed by the rounded point too.
    await waitFor(async () => {
      expect(await readCache("search:35.76,-83.97,25")).not.toBeNull();
    });
    expect(await recentLabels()).toEqual(["Maryville, TN"]);
  });

  it("a place the geocoder can't find sends nothing to the server", async () => {
    await launchNearby();
    await searchFor("Atlantis");
    expect(
      await screen.findByText(
        "We couldn't find “Atlantis”. Check the spelling or your connection, then try again.",
      ),
    ).toBeOnTheScreen();
    expect(searches()).toHaveLength(0);
    expect(await recentLabels()).toEqual([]);
  });

  it("asks for a place when the box is empty, without looking anything up", async () => {
    await launchNearby();
    await searchFor("   ");
    expect(await screen.findByText("Type a city, zip code or address.")).toBeOnTheScreen();
    expect(lookups).toEqual([]);
  });

  it("searches a recent place again without the geocoder", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Maryville, TN");
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    expect(lookups).toEqual(["Maryville, TN"]);
  });

  it("asks before forgetting recent places, and keeps them on “Keep them”", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Maryville, TN");
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Clear recent places" }));
    expect(screen.getByText("Clear your recent places from this phone?")).toBeOnTheScreen();
    expect(await recentLabels()).toEqual(["Maryville, TN"]);
    await fireEvent.press(screen.getByRole("button", { name: "Keep them" }));
    expect(screen.getByRole("button", { name: "Maryville, TN" })).toBeOnTheScreen();
    expect(await recentLabels()).toEqual(["Maryville, TN"]);
  });

  it("forgets recent places when asked", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Maryville, TN");
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Clear recent places" }));
    await fireEvent.press(screen.getByRole("button", { name: "Clear them" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Maryville, TN" })).toBeNull();
    });
    expect(await recentLabels()).toEqual([]);
  });

  it("clearing recent places forgets the last search too, so nothing typed stays on the phone", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Clear recent places" }));
    await fireEvent.press(screen.getByRole("button", { name: "Clear them" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Maryville, TN" })).toBeNull();
    });
    const db = await appDatabase();
    for (const table of ["cache_entries", "recent_places", "favorites", "settings"]) {
      const rows = await db.getAllAsync(`select * from ${table}`, []);
      expect(JSON.stringify(rows)).not.toMatch(/maryville/i);
    }
    await api.close();
    await fireEvent.press(screen.getByRole("button", { name: "Use my location" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach mymeetingapp, and this isn't saved on your phone yet. Check your connection and try again.",
    );
    api = await startApi();
  });

  it("drops a slow place lookup once a newer search has started", async () => {
    api.reply(SEARCH, { meetings: [near] });
    const slow = later<unknown>();
    setPlace("Slowtown", slow.promise);
    await launchNearby();
    await searchFor("Slowtown");
    await searchFor("Maryville, TN");
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    slow.resolve({ latitude: 40.1234, longitude: -80.5678 });
    // The person did search for it, so it's kept as a recent place; it just doesn't replace the newer search.
    await waitFor(async () => {
      expect(await recentLabels()).toEqual(["Slowtown", "Maryville, TN"]);
    });
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(screen.queryByText("Near Slowtown")).toBeNull();
    expect(searchBodies()).toEqual([{ lat: 35.76, lng: -83.97, radiusKm: 25 }]);
  });
});

describe("stale answers", () => {
  it("drops a slow place lookup once a recent place has been chosen", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    const slow = later<unknown>();
    setPlace("Slowtown", slow.promise);
    await searchFor("Slowtown");
    await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    slow.resolve({ latitude: 40.1234, longitude: -80.5678 });
    await waitFor(async () => {
      expect(await recentLabels()).toEqual(["Slowtown", "Maryville, TN"]);
    });
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(screen.queryByText("Near Slowtown")).toBeNull();
  });

  it("never shows a slow not-found answer after a newer search", async () => {
    api.reply(SEARCH, { meetings: [near] });
    const slow = later<unknown>();
    setPlace("Slowtown", slow.promise);
    await launchNearby();
    await searchFor("Slowtown");
    await searchFor("Maryville, TN");
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    slow.resolve(null);
    await waitFor(() => {
      expect(answered).toContain("Slowtown");
    });
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    expect(await screen.findByLabelText("Search for a place")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops a slow launch position once the person has searched a place", async () => {
    setLocationPermission("granted");
    const slow = later<{ latitude: number; longitude: number }>();
    setDevicePosition(slow.promise);
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    slow.resolve({ latitude: 36.162749, longitude: -86.781602 });
    await waitFor(() => {
      expect(positionsDelivered()).toBe(1);
    });
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(screen.queryByText("Near you")).toBeNull();
    expect(searchBodies()).toEqual([{ lat: 35.76, lng: -83.97, radiusKm: 25 }]);
  });

  it("doesn't let a slow launch position take over while the person is typing", async () => {
    setLocationPermission("granted");
    const slow = later<{ latitude: number; longitude: number }>();
    setDevicePosition(slow.promise);
    await launchNearby();
    await fireEvent.changeText(screen.getByLabelText("Search for a place"), "Mary");
    slow.resolve({ latitude: 36.162749, longitude: -86.781602 });
    await waitFor(() => {
      expect(positionsDelivered()).toBe(1);
    });
    expect(await screen.findByText(PROMPT)).toBeOnTheScreen();
    expect(screen.getByLabelText("Search for a place")).toHaveDisplayValue("Mary");
    expect(screen.queryByText("Near you")).toBeNull();
  });
});

describe("recent places are best effort", () => {
  it("still searches when the place can't be saved", async () => {
    const db = await appDatabase();
    jest.spyOn(db, "withTransactionAsync").mockRejectedValueOnce(new Error("disk full"));
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
  });
});

describe("Nearby with location", () => {
  it("asks on the tap, then searches around the rounded point", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(await screen.findByText("Near you")).toBeOnTheScreen();
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    expect(permissionRequests()).toBe(1);
    expect(searchBodies()).toEqual([{ lat: 36.16, lng: -86.78, radiusKm: 25 }]);
  });

  it("explains a refused permission and keeps place search", async () => {
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    setPermissionAnswer("denied");
    await launchNearby();
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(
      await screen.findByText(
        "Location is off for mymeetingapp. Search by city, zip code or address instead, or turn location on in Settings.",
      ),
    ).toBeOnTheScreen();
    const settings = screen.getByRole("button", { name: "Open Settings" });
    expect(settings).toHaveProp("accessibilityHint", "Opens this app's settings");
    await fireEvent.press(settings);
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Search for a place")).toBeOnTheScreen();
    expect(searches()).toHaveLength(0);
  });

  it("says so when the phone can't open Settings", async () => {
    jest.spyOn(Linking, "openSettings").mockRejectedValue(new Error("no settings"));
    setPermissionAnswer("denied");
    await launchNearby();
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Open Settings" }));
    expect(
      await screen.findByText(
        "This phone couldn't open Settings. You can turn location on for mymeetingapp in the Settings app.",
      ),
    ).toBeOnTheScreen();
  });

  it("says so when the phone can't find itself, and offers no Settings", async () => {
    setDevicePosition("fails");
    await launchNearby();
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(
      await screen.findByText("We couldn't get your location just now. Try again, or search by place."),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull();
    expect(searches()).toHaveLength(0);
  });

  it("starts near the person when location was allowed before, without any dialog", async () => {
    setLocationPermission("granted");
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    expect(await screen.findByText("Near you")).toBeOnTheScreen();
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    expect(permissionRequests()).toBe(0);
    expect(positionOptions()).toEqual([{ accuracy: 3, mayShowUserSettingsDialog: false }]);
    expect(searchBodies()).toEqual([{ lat: 36.16, lng: -86.78, radiusKm: 25 }]);
  });
});

describe("results", () => {
  it("says plainly when there are no in-person meetings, and shows online ones instead", async () => {
    setNow("2026-10-05T23:30:00Z");
    api.reply(SEARCH, { meetings: [] });
    api.reply("/api/v1/meetings/online?day=0", { meetings: [] });
    api.reply("/api/v1/meetings/online?day=1", {
      meetings: [
        meeting({
          name: "Zoom Early Evening",
          attendance: "online",
          conferenceUrl: "https://zoom.us/j/1",
          day: 1,
          time: "18:00",
          endTime: "19:00",
        }),
      ],
    });
    api.reply("/api/v1/meetings/online?day=2", { meetings: [] });
    await launchNearby();
    await searchFor("Maryville, TN");
    expect(
      await screen.findByText("No in-person meetings within 16 miles of Maryville, TN."),
    ).toBeOnTheScreen();
    expect(await screen.findByText("Zoom Early Evening")).toBeOnTheScreen();
  });

  it("narrows the list by time of day, and clears the filters from the list", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    // Early in the morning, every part of the day is still ahead; leave only the evening.
    await chooseFilters("Time filters, 4 chosen", ["Morning", "Afternoon", "Night"]);
    await waitFor(() => {
      expect(screen.queryByText("Near Group")).toBeNull();
    });
    expect(screen.getByText("Far Group")).toBeOnTheScreen();
    expect(screen.getByText("1 meeting · 2 filters")).toBeOnTheScreen();
    await chooseFilters("Time filters, 1 chosen", ["Evening", "Night"]);
    expect(await screen.findByText("No meetings match your filters.")).toBeOnTheScreen();
    await chooseFilters("Day filters, 1 chosen", ["Tuesday"]);
    await chooseFilters("Type filters", ["Open"]);
    await chooseFilters("Tag filters", ["Quiet"]);
    expect(await screen.findByRole("button", { name: "Tag filters, 1 chosen" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    expect(screen.getByText("Far Group")).toBeOnTheScreen();
    await expectNoFiltersChosen();
  });

  it("narrows by day, type and what people say, and the filter sheet clears them", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    await chooseFilters("Tag filters", ["Quiet"]);
    await waitFor(() => {
      expect(screen.queryByText("Far Group")).toBeNull();
    });
    expect(screen.getByText("Near Group")).toBeOnTheScreen();
    await chooseFilters("Type filters", ["Women"]);
    expect(await screen.findByText("No meetings match your filters today or tomorrow.")).toBeOnTheScreen();
    await chooseFilters("Day filters, 1 chosen", ["Tuesday"]);
    await chooseFilters("Time filters, 4 chosen", ["Morning"]);

    await fireEvent.press(await screen.findByRole("button", { name: "Day filters, 2 chosen" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Clear filters" }));
    for (const choice of ["Quiet", "Women", "Monday", "Tuesday", "Afternoon", "Evening", "Night"]) {
      expect(screen.getByRole("checkbox", { name: choice })).not.toBeChecked();
    }
    await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    expect(screen.getByText("Near Group")).toBeOnTheScreen();
    await expectNoFiltersChosen();

    await chooseFilters("Day filters", ["Tuesday"]);
    expect(await screen.findByText("No meetings match your filters.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Day filters, 1 chosen" })).toBeOnTheScreen();
  });

  describe("filters start as today, from now on (owner decision, 2026-09-30)", () => {
    const late = nearbyMeeting({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Late Group",
      day: 1,
      time: "23:00",
      latitude: 35.7567,
      longitude: -83.9707,
      distanceKm: 1.7,
    });
    const tuesday = nearbyMeeting({
      id: "44444444-4444-4444-8444-444444444444",
      name: "Tuesday Group",
      day: 2,
      time: "19:00",
      latitude: 35.7568,
      longitude: -83.9708,
      distanceKm: 1.8,
    });
    // Listed on Tuesday, but tonight's to someone up on Monday night.
    const midnight = nearbyMeeting({
      id: "77777777-7777-4777-8777-777777777777",
      name: "Midnight Group",
      day: 2,
      time: "00:00",
      latitude: 35.7569,
      longitude: -83.9709,
      distanceKm: 1.9,
    });
    const quarterTo = {
      ...late,
      id: "88888888-8888-4888-8888-888888888888",
      name: "Quarter To Group",
      time: "23:45",
    };
    const early = {
      ...tuesday,
      id: "99999999-9999-4999-8999-999999999999",
      name: "Early Group",
      time: "07:00",
    };
    const ALL = [
      "Near Group",
      "Far Group",
      "Late Group",
      "Tuesday Group",
      "Midnight Group",
      "Quarter To Group",
      "Early Group",
    ];

    async function searchAt(iso: string, more: (typeof late)[] = []) {
      setNow(iso);
      api.reply(SEARCH, { meetings: [far, near, late, tuesday, ...more] });
      await launchNearby();
      await searchFor("Maryville, TN");
    }

    // The meetings listed, in order, with "Tomorrow" where that section's heading falls.
    async function expectListed(names: string[]) {
      await waitFor(() => {
        expect(shownInOrder([...ALL, "Tomorrow"])).toEqual(names);
      });
    }

    it("at 6 PM on a Monday, chooses Monday and the evening and night", async () => {
      await searchAt("2026-10-05T23:00:00Z");
      await expectListed(["Far Group", "Late Group", "Tomorrow", "Tuesday Group"]);
      // The line counts today's, not tomorrow's.
      expect(screen.getByText("2 meetings · today from now")).toBeOnTheScreen();
      await openFilters();
      expect(screen.getByRole("button", { name: "Day filters, 1 chosen" })).toBeSelected();
      expect(screen.getByRole("button", { name: "Time filters, 2 chosen" })).toBeSelected();
      expect(screen.getByRole("button", { name: "Type filters" })).not.toBeSelected();
      expect(screen.getByRole("button", { name: "Tag filters" })).not.toBeSelected();
      await fireEvent.press(screen.getByRole("button", { name: "Time filters, 2 chosen" }));
      for (const choice of ["Monday", "Evening", "Night"])
        expect(await screen.findByRole("checkbox", { name: choice })).toBeChecked();
      for (const choice of ["Tuesday", "Morning", "Afternoon"])
        expect(screen.getByRole("checkbox", { name: choice })).not.toBeChecked();
    });

    it("late at night, chooses only the night", async () => {
      await searchAt("2026-10-06T03:30:00Z");
      await expectListed(["Late Group", "Tomorrow", "Tuesday Group"]);
      expect(screen.getByText("1 meeting · today from now")).toBeOnTheScreen();
      await openFilters();
      expect(screen.getByRole("button", { name: "Day filters, 1 chosen" })).toBeOnTheScreen();
      expect(screen.getByRole("button", { name: "Time filters, 1 chosen" })).toBeOnTheScreen();
    });

    // Owner decision D1: the night runs until 5 AM, so today, from now on, includes tonight's meetings after
    // midnight, which are listed on tomorrow's weekday.
    it("at 11 PM, includes tonight's meetings after midnight", async () => {
      await searchAt("2026-10-06T04:00:00Z", [midnight]);
      await expectListed(["Late Group", "Midnight Group", "Tomorrow", "Tuesday Group"]);
      expect(screen.getByText("2 meetings · today from now")).toBeOnTheScreen();
    });

    // Owner decision D1, as corrected: until 5 AM it's still today on the phone's calendar, so the list runs to 5 AM the
    // next morning, and the night and every later part of the day are ahead.
    it("after midnight, lists the rest of the night and all of today, and a meeting from before midnight that began under an hour ago", async () => {
      // Tuesday 12:30 AM.
      await searchAt("2026-10-06T05:30:00Z", [midnight, quarterTo]);
      await expectListed(["Quarter To Group", "Midnight Group", "Tuesday Group"]);
      await openFilters();
      expect(screen.getByRole("button", { name: "Day filters, 1 chosen" })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("button", { name: "Time filters, 4 chosen" }));
      for (const choice of ["Tuesday", "Night", "Morning", "Afternoon", "Evening"])
        expect(await screen.findByRole("checkbox", { name: choice })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Monday" })).not.toBeChecked();
    });

    it("at 3 AM, lists all of today, its early morning included, but not last night's meeting from over an hour ago", async () => {
      // Tuesday 3 AM.
      await searchAt("2026-10-06T08:00:00Z", [quarterTo, early]);
      await expectListed(["Early Group", "Tuesday Group"]);
      await openFilters();
      expect(screen.getByRole("button", { name: "Time filters, 4 chosen" })).toBeOnTheScreen();
    });

    it("lists the whole day from 5 AM", async () => {
      // Tuesday 5:00 AM.
      await searchAt("2026-10-06T10:00:00Z", [midnight]);
      await expectListed(["Tuesday Group"]);
      await openFilters();
      expect(screen.getByRole("button", { name: "Time filters, 4 chosen" })).toBeOnTheScreen();
    });

    it("Clear shows every meeting, and a new search doesn't choose them again", async () => {
      await searchAt("2026-10-05T23:00:00Z");
      await expectListed(["Far Group", "Late Group", "Tomorrow", "Tuesday Group"]);
      await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
      await expectListed(["Far Group", "Late Group", "Tuesday Group", "Near Group"]);
      expect(screen.getByText("4 meetings")).toBeOnTheScreen();
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
      await expectNoFiltersChosen();
      await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
      await expectListed(["Far Group", "Late Group", "Tuesday Group", "Near Group"]);
      await expectNoFiltersChosen();
    });

    describe("leaving out today's meetings that began over an hour ago", () => {
      const smallHours = nearbyMeeting({
        id: "55555555-5555-4555-8555-555555555555",
        name: "Small Hours Group",
        day: 1,
        time: "00:30",
        latitude: 35.7567,
        longitude: -83.9707,
      });
      const justBegun = nearbyMeeting({
        id: "66666666-6666-4666-8666-666666666666",
        name: "Just Begun Group",
        day: 1,
        time: "21:30",
        latitude: 35.7567,
        longitude: -83.9707,
      });

      // Night also covers the small hours of the same day, so at 10 PM it would bring back this morning's 12:30 AM.
      async function searchAtTenPm() {
        setNow("2026-10-06T03:00:00Z");
        api.reply(SEARCH, { meetings: [smallHours, justBegun, late] });
        await launchNearby();
        await searchFor("Maryville, TN");
        expect(await screen.findByText("Just Begun Group")).toBeOnTheScreen();
        expect(screen.getByText("Late Group")).toBeOnTheScreen();
        expect(screen.queryByText("Small Hours Group")).toBeNull();
        expect(screen.getByText("2 meetings · today from now")).toBeOnTheScreen();
      }

      // Owner decision D2: the filter groups are independent.
      it("still leaves them out when the person chooses only a type or a tag", async () => {
        await searchAtTenPm();
        await chooseFilters("Type filters", ["Open"]);
        expect(await screen.findByRole("button", { name: "Type filters, 1 chosen" })).toBeOnTheScreen();
        expect(screen.getByText("Just Begun Group")).toBeOnTheScreen();
        expect(screen.queryByText("Small Hours Group")).toBeNull();
        expect(screen.getByRole("button", { name: "Day filters, 1 chosen" })).toBeSelected();
        expect(screen.getByRole("button", { name: "Time filters, 1 chosen" })).toBeSelected();
        await fireEvent.press(screen.getByRole("button", { name: "Day filters, 1 chosen" }));
        for (const choice of ["Monday", "Night", "Open"])
          expect(await screen.findByRole("checkbox", { name: choice })).toBeChecked();
      });

      it.each([
        ["Day filters, 1 chosen", "Tuesday"],
        ["Time filters, 1 chosen", "Evening"],
      ])("shows them once the person changes %s themselves (%s)", async (pill, choice) => {
        await searchAtTenPm();
        await chooseFilters(pill, [choice]);
        expect(await screen.findByText("Small Hours Group")).toBeOnTheScreen();
        expect(screen.getByText("3 meetings · 2 filters")).toBeOnTheScreen();
      });
    });

    describe("tomorrow, after today (owner decision, 2026-09-30)", () => {
      // Tomorrow's, at 6 AM, nearer than the rest but farther than the Early Group.
      const dawn = {
        ...far,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Dawn Group",
        day: 2,
        time: "06:00",
      };
      const quietEarly = { ...early, tags: [{ slug: "quiet", count: 2 }] };
      const ALL_WITH_TOMORROW = [...ALL, "Dawn Group", "Tomorrow"];

      it("lists tomorrow's meetings under their own heading, after today's, each section in the chosen order", async () => {
        await searchAt("2026-10-05T23:00:00Z", [quietEarly, dawn]);
        await waitFor(() => {
          expect(shownInOrder(ALL_WITH_TOMORROW)).toEqual([
            "Far Group",
            "Late Group",
            "Tomorrow",
            "Dawn Group",
            "Early Group",
            "Tuesday Group",
          ]);
        });
        expect(screen.getByRole("header", { name: "Tomorrow" })).toBeOnTheScreen();
        await openFilters();
        await fireEvent.press(screen.getByRole("button", { name: "Sort nearest first" }));
        await waitFor(() => {
          expect(shownInOrder(ALL_WITH_TOMORROW)).toEqual([
            "Late Group",
            "Far Group",
            "Tomorrow",
            "Early Group",
            "Tuesday Group",
            "Dawn Group",
          ]);
        });
      });

      it("applies the chosen tags to tomorrow too, and says when only tomorrow has a match", async () => {
        await searchAt("2026-10-05T23:00:00Z", [quietEarly, dawn]);
        await screen.findByText("Dawn Group");
        await chooseFilters("Tag filters", ["Quiet"]);
        expect(await screen.findByText("No meetings match your filters tonight.")).toBeOnTheScreen();
        expect(shownInOrder(ALL_WITH_TOMORROW)).toEqual(["Tomorrow", "Early Group"]);
        expect(screen.getByRole("button", { name: "Clear" })).toBeOnTheScreen();
      });

      it.each([
        ["Day filters, 1 chosen", "Tuesday"],
        ["Time filters, 2 chosen", "Morning"],
      ])(
        "has no Tomorrow once the person changes %s themselves (%s): their filters decide",
        async (pill, choice) => {
          await searchAt("2026-10-05T23:00:00Z", [quietEarly, dawn]);
          await screen.findByText("Dawn Group");
          await chooseFilters(pill, [choice]);
          await waitFor(() => {
            expect(screen.queryByText("Tomorrow")).toBeNull();
          });
          expect(screen.queryByText(/today from now/)).toBeNull();
        },
      );

      it("says “today” rather than “tonight” before the evening", async () => {
        // Monday 12:30 PM: the morning's group began hours ago.
        setNow("2026-10-05T17:30:00Z");
        api.reply(SEARCH, { meetings: [near, tuesday] });
        await launchNearby();
        await searchFor("Maryville, TN");
        expect(await screen.findByText("No more meetings nearby today.")).toBeOnTheScreen();
        expect(shownInOrder(ALL_WITH_TOMORROW)).toEqual(["Tomorrow", "Tuesday Group"]);
      });
    });

    // The owner's iPhone at 10:17 PM on a Wednesday: nothing in person is left tonight, so the list goes straight on to
    // tomorrow morning rather than to a long list of online meetings.
    describe("late at night, with nothing left tonight", () => {
      // Wednesday 10:17 PM.
      const WEDNESDAY_LATE = "2026-10-08T03:17:00Z";
      const wednesday = nearbyMeeting({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Wednesday Evening Group",
        day: 3,
        time: "19:00",
        tags: [{ slug: "quiet", count: 2 }],
      });
      const happyDestiny = nearbyMeeting({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Happy Destiny",
        day: 4,
        time: "07:00",
      });
      const thursdayNoon = {
        ...happyDestiny,
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        name: "Thursday Noon",
        time: "12:00",
      };
      const friday = {
        ...happyDestiny,
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        name: "Friday Group",
        day: 5,
      };
      const NAMES = ["Wednesday Evening Group", "Happy Destiny", "Thursday Noon", "Friday Group", "Tomorrow"];
      const zoomNightOwls = meeting({
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        name: "Zoom Night Owls",
        attendance: "online",
        conferenceUrl: "https://zoom.us/j/2",
        day: 3,
        time: "22:30",
        endTime: "23:30",
      });

      async function searchLate(meetings: (typeof wednesday)[]) {
        setNow(WEDNESDAY_LATE);
        api.reply(SEARCH, { meetings });
        api.reply("/api/v1/meetings/online?day=2", { meetings: [] });
        api.reply("/api/v1/meetings/online?day=3", { meetings: [zoomNightOwls] });
        api.reply("/api/v1/meetings/online?day=4", { meetings: [] });
        const app = await launchNearby();
        await searchFor("Maryville, TN");
        return app;
      }

      it("says so and goes straight on to tomorrow's meetings", async () => {
        await searchLate([wednesday, friday, thursdayNoon, happyDestiny]);
        expect(await screen.findByText("No more meetings nearby tonight.")).toBeOnTheScreen();
        expect(shownInOrder(NAMES)).toEqual(["Tomorrow", "Happy Destiny", "Thursday Noon"]);
        expect(screen.getByRole("button", { name: /^Happy Destiny, Thu 7:00 AM, / })).toBeOnTheScreen();
        // The way out is in view with the Filters panel closed, and no online meetings: there's tomorrow.
        expect(filtersToggle()).toHaveProp("accessibilityState", { expanded: false });
        expect(screen.getByRole("button", { name: "Clear" })).toBeOnTheScreen();
        expect(screen.queryByRole("button", { name: /^Online now/ })).toBeNull();
        expect(screen.queryByText("Online meetings you can join")).toBeNull();
      });

      it("with nothing tomorrow either, links to the Online tab instead of listing online meetings", async () => {
        const app = await searchLate([wednesday, friday]);
        expect(await screen.findByText("No more meetings nearby tonight or tomorrow.")).toBeOnTheScreen();
        expect(screen.queryByText("Tomorrow")).toBeNull();
        const online = await screen.findByRole("button", { name: "Online now (1)" });
        expect(online).toHaveProp("accessibilityHint", "Opens the Online tab");
        expect(online).toHaveStyle({ borderWidth: 0, minHeight: 44, minWidth: 44 });
        expect(screen.queryByText("Online meetings you can join")).toBeNull();
        expect(screen.queryByText("Zoom Night Owls")).toBeNull();
        await fireEvent.press(online);
        expect(await screen.findByText("Zoom Night Owls")).toBeOnTheScreen();
        expect(app.getPathname()).toBe("/online");
      });

      it("leaves the count out when the online meetings can't be read, rather than guessing", async () => {
        setNow(WEDNESDAY_LATE);
        api.reply(SEARCH, { meetings: [wednesday] });
        api.reply("/api/v1/meetings/online?day=2", { meetings: [] });
        api.reply("/api/v1/meetings/online?day=3", { problem: "down" }, 500);
        api.reply("/api/v1/meetings/online?day=4", { meetings: [] });
        await launchNearby();
        await searchFor("Maryville, TN");
        expect(await screen.findByRole("button", { name: "Online now" })).toHaveProp(
          "accessibilityHint",
          "Opens the Online tab",
        );
      });

      // Once the person chooses something, even only a tag, it's their filters that match nothing.
      it("once the person has chosen a tag, blames the filters and offers only Clear", async () => {
        await searchLate([wednesday, friday]);
        await screen.findByRole("button", { name: "Online now (1)" });
        await chooseFilters("Tag filters", ["Quiet"]);
        expect(
          await screen.findByText("No meetings match your filters tonight or tomorrow."),
        ).toBeOnTheScreen();
        expect(screen.queryByRole("button", { name: /^Online now/ })).toBeNull();
        await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
        expect(await screen.findByText("Wednesday Evening Group")).toBeOnTheScreen();
        expect(screen.queryByText(/^No /)).toBeNull();
        expect(screen.queryByRole("button", { name: /^Online now/ })).toBeNull();
      });
    });

    it("moves on to the new day while the app stays open, and a group the person hasn't changed keeps following the clock", async () => {
      const playAppState = spyOnAppState();
      await searchAt("2026-10-06T04:50:00Z");
      await expectListed(["Late Group", "Tomorrow", "Tuesday Group"]);
      // Tuesday 12:10 AM.
      setNow("2026-10-06T05:10:00Z");
      await playAppState("background");
      await playAppState("active");
      await expectListed(["Tuesday Group"]);
      await openFilters();
      expect(screen.getByRole("button", { name: "Time filters, 4 chosen" })).toBeOnTheScreen();

      await chooseFilters("Day filters, 1 chosen", ["Monday"]);
      await expectListed(["Tuesday Group", "Near Group", "Far Group", "Late Group"]);
      // Tuesday 6 PM: the days are the person's, and the times are still today's from now on.
      setNow("2026-10-06T23:00:00Z");
      await playAppState("background");
      await playAppState("active");
      await expectListed(["Tuesday Group", "Far Group", "Late Group"]);
      expect(screen.getByRole("button", { name: "Day filters, 2 chosen" })).toBeOnTheScreen();
      expect(screen.getByRole("button", { name: "Time filters, 2 chosen" })).toBeOnTheScreen();
    });
  });

  describe("the order of the list: soonest or nearest (owner decision, 2026-09-30)", () => {
    const at = (name: string, id: string, time: string, place: "here" | "away") =>
      nearbyMeeting({
        id: `${id}1111111-1111-4111-8111-111111111111`,
        name,
        day: 1,
        time,
        ...(place === "here"
          ? { latitude: 35.7566, longitude: -83.9706, distanceKm: 0.5 }
          : { latitude: 35.77, longitude: -83.99, distanceKm: 0.4 }),
      });
    // In the server's order, which is by the rounded point's distance (Away's is the nearer) and says nothing about
    // time.
    const MEETINGS = [
      at("Five Away", "2", "17:00", "away"),
      at("Five Here", "1", "17:00", "here"),
      at("Eight Here", "3", "20:00", "here"),
      at("Three Away", "4", "15:00", "away"),
      at("One Here", "5", "13:00", "here"),
    ];
    const listed = async () =>
      (await screen.findAllByRole("button", { name: /(Here|Away), Mon/ })).map((card) =>
        String(card.props.accessibilityLabel).replace(/, Mon.*/, ""),
      );

    async function searchAtLunchtime() {
      // Monday 12:30 PM, so every meeting is still ahead today.
      setNow("2026-10-05T17:30:00Z");
      api.reply(SEARCH, { meetings: MEETINGS });
      await launchNearby();
      await searchFor("Maryville, TN");
      await screen.findByText("One Here");
      await openFilters();
    }

    it("starts with the soonest first, the nearest first at the same time", async () => {
      await searchAtLunchtime();
      expect(await listed()).toEqual(["One Here", "Three Away", "Five Here", "Five Away", "Eight Here"]);
      expect(screen.getByRole("button", { name: "Sort soonest first" })).toBeSelected();
      expect(screen.getByRole("button", { name: "Sort nearest first" })).not.toBeSelected();
      expect(screen.getByText("Soonest")).toBeOnTheScreen();
      expect(screen.getByText("Nearest")).toBeOnTheScreen();
    });

    it("sorts the nearest first on Nearest, the soonest first at the same place", async () => {
      await searchAtLunchtime();
      await fireEvent.press(screen.getByRole("button", { name: "Sort nearest first" }));
      await waitFor(async () => {
        expect(await listed()).toEqual(["One Here", "Five Here", "Eight Here", "Three Away", "Five Away"]);
      });
      expect(screen.getByRole("button", { name: "Sort nearest first" })).toBeSelected();
      expect(screen.getByRole("button", { name: "Sort soonest first" })).not.toBeSelected();
    });

    it("works out each meeting's next start once for the order and the filters, and only when something changes", async () => {
      const upcoming = jest.spyOn(schedule, "upcomingStart");
      await searchAtLunchtime();
      upcoming.mockClear();
      // Switching to the map and back changes nothing the list depends on.
      await fireEvent.press(screen.getByRole("button", { name: "Map" }));
      await fireEvent.press(screen.getByRole("button", { name: "List" }));
      expect(await screen.findByText("One Here")).toBeOnTheScreen();
      expect(upcoming).not.toHaveBeenCalled();
      // A new order is one pass: once for each of the five meetings.
      await fireEvent.press(screen.getByRole("button", { name: "Sort nearest first" }));
      await waitFor(async () => {
        expect(await listed()).toEqual(["One Here", "Five Here", "Eight Here", "Three Away", "Five Away"]);
      });
      expect(upcoming).toHaveBeenCalledTimes(5);
    });

    it("keeps the choice through a new search, but not once the app is closed", async () => {
      await searchAtLunchtime();
      await fireEvent.press(screen.getByRole("button", { name: "Sort nearest first" }));
      await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
      await waitFor(async () => {
        expect(await listed()).toEqual(["One Here", "Five Here", "Eight Here", "Three Away", "Five Away"]);
      });
      expect(screen.getByRole("button", { name: "Sort nearest first" })).toBeSelected();

      await cleanup();
      await launchNearby();
      await searchFor("Maryville, TN");
      await screen.findByText("One Here");
      expect(await listed()).toEqual(["One Here", "Three Away", "Five Here", "Five Away", "Eight Here"]);
      await openFilters();
      expect(screen.getByRole("button", { name: "Sort soonest first" })).toBeSelected();
    });
  });

  // The controls took half an iPhone's screen before the first meeting; they now fold away (owner decision,
  // 2026-09-30).
  describe("the filters panel", () => {
    async function searchMaryville() {
      api.reply(SEARCH, { meetings: [far, near] });
      await launchNearby();
      await searchFor("Maryville, TN");
      await screen.findByText("Near Group");
    }

    it("starts collapsed, saying how many filter groups are chosen and what's on", async () => {
      await searchMaryville();
      const toggle = filtersToggle();
      expect(toggle).toHaveAccessibleName("Filters, 2 chosen");
      expect(toggle).toHaveProp("accessibilityHint", "Shows the filters and sort order");
      expect(toggle).toHaveProp("accessibilityState", { expanded: false });
      expect(within(toggle).getByText("Filters · 2")).toBeOnTheScreen();
      expect(screen.getByText("2 meetings · today from now")).toBeOnTheScreen();
      for (const hidden of ["Day filters, 1 chosen", "Sort soonest first"])
        expect(screen.queryByRole("button", { name: hidden })).toBeNull();
      // The way out sits on the summary line, as a link, while anything is chosen.
      const clear = screen.getByRole("button", { name: "Clear" });
      expect(clear).toHaveProp("accessibilityHint", "Clears the filters, to show every meeting");
      expect(clear).toHaveStyle({ borderWidth: 0, minHeight: 44, minWidth: 44 });
      expect(screen.getByRole("button", { name: "List" })).toBeSelected();
    });

    // The owner's design: one control style on the List / Map row.
    it("draws the Filters toggle as a pill, selected while something is chosen, with an arrow that turns", async () => {
      await searchMaryville();
      const look = (name: string | RegExp): unknown => {
        const style: unknown = screen.getByRole("button", { name }).props.style;
        return style;
      };
      expect(look(/^Filters/)).toEqual(look("List"));
      // One glyph, turned over when open: ▴ falls back to another font on iOS and draws larger than ▾.
      expect(within(filtersToggle()).getByText("▾")).not.toHaveStyle({ transform: [{ rotate: "180deg" }] });
      await fireEvent.press(filtersToggle());
      expect(within(filtersToggle()).getByText("▾")).toHaveStyle({ transform: [{ rotate: "180deg" }] });
      await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
      await screen.findByRole("button", { name: "Filters" });
      expect(look("Filters")).toEqual(look("Map"));
      expect(look("Filters")).not.toEqual(look("List"));
    });

    // The owner's design: a plain link beside the heading, not a box competing with the pills.
    it("offers Change place as a text link that still says what it does", async () => {
      await searchMaryville();
      const changePlace = screen.getByRole("button", { name: "Change place" });
      expect(changePlace).toHaveProp("accessibilityHint", "Searches somewhere else");
      expect(changePlace).toHaveStyle({ borderWidth: 0, minHeight: 44, minWidth: 44 });
      await fireEvent.press(changePlace);
      expect(await screen.findByLabelText("Search for a place")).toBeOnTheScreen();
    });

    it("opens to show the filter groups and the sort, and closes again", async () => {
      await searchMaryville();
      await fireEvent.press(filtersToggle());
      expect(filtersToggle()).toHaveProp("accessibilityState", { expanded: true });
      expect(filtersToggle()).toHaveProp("accessibilityHint", "Hides the filters and sort order");
      for (const name of [
        "Day filters, 1 chosen",
        "Time filters, 4 chosen",
        "Type filters",
        "Tag filters",
        "Sort soonest first",
        "Sort nearest first",
      ])
        expect(screen.getByRole("button", { name })).toBeOnTheScreen();
      expect(screen.getByText("Sort")).toBeOnTheScreen();
      await fireEvent.press(filtersToggle());
      expect(filtersToggle()).toHaveProp("accessibilityState", { expanded: false });
      expect(screen.queryByRole("button", { name: "Sort soonest first" })).toBeNull();
    });

    it("counts the chosen groups and sums up the filters and the order as they change", async () => {
      await searchMaryville();
      await openFilters();
      await chooseFilters("Type filters", ["Open"]);
      expect(await screen.findByText("2 meetings · today from now · 1 more filter")).toBeOnTheScreen();
      expect(filtersToggle()).toHaveAccessibleName("Filters, 3 chosen");
      expect(within(filtersToggle()).getByText("Filters · 3")).toBeOnTheScreen();
      await chooseFilters("Time filters, 4 chosen", ["Morning"]);
      expect(await screen.findByText("1 meeting · 3 filters")).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("button", { name: "Sort nearest first" }));
      expect(await screen.findByText("1 meeting · 3 filters · nearest")).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
      expect(await screen.findByText("2 meetings · nearest")).toBeOnTheScreen();
      expect(filtersToggle()).toHaveAccessibleName("Filters");
      expect(within(filtersToggle()).getByText("Filters")).toBeOnTheScreen();
    });

    it("stays open through the filter sheet and a new search, and starts collapsed when Nearby opens again", async () => {
      await searchMaryville();
      await openFilters();
      await chooseFilters("Tag filters", ["Quiet"]);
      expect(await screen.findByRole("button", { name: "Tag filters, 1 chosen" })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
      await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
      expect(await screen.findByRole("button", { name: "Tag filters, 1 chosen" })).toBeOnTheScreen();

      await cleanup();
      await searchMaryville();
      expect(filtersToggle()).toHaveProp("accessibilityState", { expanded: false });
    });

    it("keeps one Clear in view, beside the message, when nothing matches, the panel open or closed", async () => {
      await searchMaryville();
      await openFilters();
      await chooseFilters("Type filters", ["Women"]);
      expect(await screen.findByText("No meetings match your filters today or tomorrow.")).toBeOnTheScreen();
      expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
      await fireEvent.press(filtersToggle());
      expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Sort soonest first" })).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
      expect(await screen.findByText("2 meetings")).toBeOnTheScreen();
    });
  });

  it("puts Help in the filter sheet's header", async () => {
    await renderApp("/filters");
    expect(await screen.findByRole("button", { name: "Help now: crisis lines" })).toBeOnTheScreen();
    await waitFor(async () => {
      expect(await readCache("config")).not.toBeNull();
      expect(await readCache("vocabulary")).not.toBeNull();
    });
  });

  it("labels a saved search shown offline", async () => {
    setNow("2026-10-05T11:00:00Z");
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    setNow("2026-10-05T12:20:00Z");
    await api.close();
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(
      await screen.findByText(
        "Showing the copy saved today at 6:00 AM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Near Group")).toBeOnTheScreen();
    api = await startApi();
  });

  it("labels a saved empty search shown offline, above the online fallback", async () => {
    setNow("2026-10-05T20:00:00Z");
    api.reply(SEARCH, { meetings: [] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("No in-person meetings within 16 miles of Maryville, TN.");
    setNow("2026-10-05T21:20:00Z");
    await api.close();
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(
      await screen.findByText(
        "Showing the copy saved today at 3:00 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("No in-person meetings within 16 miles of Maryville, TN.")).toBeOnTheScreen();
    api = await startApi();
  });

  it("says so when a search fails on a fresh install, with nothing saved", async () => {
    await launchNearby();
    await searchFor("Maryville, TN");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach mymeetingapp, and this isn't saved on your phone yet. Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Change place" })).toBeOnTheScreen();
  });

  it("offline, a search somewhere new shows the last search, described by where it was made", async () => {
    setNow("2026-10-05T11:40:00Z");
    api.reply(SEARCH, { meetings: [far, near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    setNow("2026-10-05T12:00:00Z");
    await api.close();
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(
      await screen.findByText(
        "Showing your last search, near Maryville, TN, saved today at 6:40 AM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(screen.queryByText("Near you")).toBeNull();
    // Measured from the last search's rounded point (35.76, -83.97), not from where the phone is now.
    const cards = screen.getAllByRole("button", { name: /Group, Mon/ });
    expect(cards[0]).toHaveAccessibleName("Near Group, Mon 8:00 AM, 0.2 mi, St. Luke's, Quiet 2 people");
    expect(cards[1]).toHaveAccessibleName("Far Group, Mon 7:00 PM, 1.3 mi, St. Luke's, Welcoming 14 people");
    api = await startApi();
  });

  it("offline, doesn't work the last search's list out again on every render", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    await api.close();
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(await screen.findByText(/^Showing your last search, near Maryville, TN/)).toBeOnTheScreen();
    const upcoming = jest.spyOn(schedule, "upcomingStart");
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    await fireEvent.press(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    expect(upcoming).not.toHaveBeenCalled();
    api = await startApi();
  });

  it("offline, names a last search made near the person by when, not as “you”", async () => {
    setNow("2026-10-05T11:40:00Z");
    setLocationPermission("granted");
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await screen.findByText("Near Group");
    await api.close();
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await searchFor("Maryville, TN");
    expect(
      await screen.findByText(
        "Showing your last search, near your earlier location, saved today at 6:40 AM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Near your earlier location")).toBeOnTheScreen();
    expect(screen.queryByText("Near Maryville, TN")).toBeNull();
    api = await startApi();
  });

  it("reads the tag list again on the next screen change after it failed, without waiting for a foreground", async () => {
    api.reply("/api/v1/vocabulary", { problem: "offline" }, 500);
    api.reply(SEARCH, { meetings: [near] });
    await renderApp("/");
    await searchFor("Maryville, TN");
    expect(
      await screen.findByRole("button", { name: "Near Group, Mon 8:00 AM, under 0.1 mi, St. Luke's" }),
    ).toBeOnTheScreen();
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await fireEvent.press(screen.getByLabelText("Me"));
    await fireEvent.press(await screen.findByLabelText("Nearby"));
    expect(
      await screen.findByRole("button", {
        name: "Near Group, Mon 8:00 AM, under 0.1 mi, St. Luke's, Quiet 2 people",
      }),
    ).toBeOnTheScreen();
  });

  it("reads the search again when the app comes back after the reuse window", async () => {
    const playAppState = spyOnAppState();
    setNow("2026-10-05T11:00:00Z");
    api.reply(SEARCH, { meetings: [near] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    setNow("2026-10-05T12:20:00Z");
    api.reply(SEARCH, { meetings: [far, near] });
    await playAppState("background");
    await playAppState("active");
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    expect(searches()).toHaveLength(2);
    // The tag list is read again on the same return; let it land before the test ends.
    await waitFor(async () => {
      expect((await readCache("vocabulary"))?.savedAt).toEqual(new Date("2026-10-05T12:20:00Z"));
    });
  });
});
