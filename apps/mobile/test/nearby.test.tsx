import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus, Linking } from "react-native";

import { readCache } from "@/cache/store";
import { recentPlaces } from "@/location/recent-places";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, nearbyMeeting, VOCABULARY } from "./fixtures";
import {
  permissionChecks,
  permissionRequests,
  positionOptions,
  setDevicePosition,
  setLocationPermission,
  setPermissionAnswer,
} from "./native/expo-location";
import { lookups, setPlace } from "./native/native-location";
import { renderApp } from "./render-app";

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

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  setPlace("Maryville, TN", MARYVILLE);
});
afterEach(async () => {
  await api.close();
});

// Opens Nearby and waits for launch to settle (the config and tag list read and saved, and Nearby's look at whether
// location was allowed), so nothing from launch lands in the middle of what a test does next.
async function launch() {
  await renderApp("/");
  await waitFor(async () => {
    expect(await readCache("config")).not.toBeNull();
    expect(await readCache("vocabulary")).not.toBeNull();
    expect(permissionChecks()).toBeGreaterThan(0);
  });
}

async function searchFor(text: string) {
  await fireEvent.changeText(await screen.findByLabelText("Search for a place"), text);
  await fireEvent.press(screen.getByRole("button", { name: "Search" }));
}

async function chooseFilters(pill: string, choices: string[]) {
  await fireEvent.press(await screen.findByRole("button", { name: pill }));
  for (const choice of choices) await fireEvent.press(await screen.findByRole("checkbox", { name: choice }));
  await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
}

// A geocoder answer the test hands over when it chooses.
function later<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

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
    await launch();
    expect(screen.getByText(PROMPT)).toBeOnTheScreen();
    expect(permissionRequests()).toBe(0);
    expect(positionOptions()).toEqual([]);
    expect(searches()).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("finds a typed place on the phone, sends only the rounded point, and sorts by exact distance", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    await launch();
    await searchFor("Maryville, TN");
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    const cards = await screen.findAllByRole("button", { name: /Group, Mon/ });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAccessibleName(
      "Near Group, Mon 8:00 AM, under 0.1 mi, St. Luke's, Quiet 2 people",
    );
    expect(cards[1]).toHaveAccessibleName("Far Group, Mon 7:00 PM, 1.4 mi, St. Luke's, Welcoming 14 people");
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
    await launch();
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
    await launch();
    await searchFor("   ");
    expect(await screen.findByText("Type a city, zip code or address.")).toBeOnTheScreen();
    expect(lookups).toEqual([]);
  });

  it("searches a recent place again without the geocoder", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launch();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Maryville, TN");
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    expect(lookups).toEqual(["Maryville, TN"]);
  });

  it("forgets recent places when asked", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launch();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Maryville, TN");
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Clear recent places" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Maryville, TN" })).toBeNull();
    });
    expect(await recentLabels()).toEqual([]);
  });

  it("drops a slow place lookup once a newer search has started", async () => {
    api.reply(SEARCH, { meetings: [near] });
    const slow = later<unknown>();
    setPlace("Slowtown", slow.promise);
    await launch();
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

describe("Nearby with location", () => {
  it("asks on the tap, then searches around the rounded point", async () => {
    api.reply(SEARCH, { meetings: [near] });
    await launch();
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(await screen.findByText("Near you")).toBeOnTheScreen();
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    expect(permissionRequests()).toBe(1);
    expect(searchBodies()).toEqual([{ lat: 36.16, lng: -86.78, radiusKm: 25 }]);
  });

  it("explains a refused permission and keeps place search", async () => {
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    setPermissionAnswer("denied");
    await launch();
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(
      await screen.findByText(
        "Location is off for mymeetingapp. Search by city, zip code or address instead, or turn location on in Settings.",
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Search for a place")).toBeOnTheScreen();
    expect(searches()).toHaveLength(0);
  });

  it("says so when the phone can't find itself, and offers no Settings", async () => {
    setDevicePosition("fails");
    await launch();
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
    await launch();
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
    await launch();
    await searchFor("Maryville, TN");
    expect(
      await screen.findByText("No in-person meetings within 16 miles of Maryville, TN."),
    ).toBeOnTheScreen();
    expect(await screen.findByText("Zoom Early Evening")).toBeOnTheScreen();
  });

  it("narrows the list by time of day, and clears the filters from the list", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    await launch();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    await chooseFilters("Time filters", ["Evening"]);
    await waitFor(() => {
      expect(screen.queryByText("Near Group")).toBeNull();
    });
    expect(screen.getByText("Far Group")).toBeOnTheScreen();
    await chooseFilters("Time filters, 1 chosen", ["Evening", "Night"]);
    expect(await screen.findByText("No meetings match your filters.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
    expect(screen.getByText("Far Group")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Time filters" })).toBeOnTheScreen();
  });

  it("narrows by day, type and what people say, and the filter sheet clears them", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    await launch();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    await chooseFilters("Tags filters", ["Quiet"]);
    await waitFor(() => {
      expect(screen.queryByText("Far Group")).toBeNull();
    });
    expect(screen.getByText("Near Group")).toBeOnTheScreen();
    await chooseFilters("Type filters", ["Women"]);
    expect(await screen.findByText("No meetings match your filters.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Day filters" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("checkbox", { name: "Quiet" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Women" })).not.toBeChecked();
    await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    expect(screen.getByText("Near Group")).toBeOnTheScreen();

    await chooseFilters("Day filters", ["Tuesday"]);
    expect(await screen.findByText("No meetings match your filters.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Day filters, 1 chosen" })).toBeOnTheScreen();
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
    setNow("2026-10-05T20:00:00Z");
    api.reply(SEARCH, { meetings: [near] });
    await launch();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    setNow("2026-10-05T21:20:00Z");
    await api.close();
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(
      await screen.findByText(
        "Showing the copy saved today at 3:00 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Near Group")).toBeOnTheScreen();
    api = await startApi();
  });

  it("says so when a search fails with no saved copy", async () => {
    await launch();
    await searchFor("Maryville, TN");
    expect(
      await screen.findByText(
        "We couldn't reach mymeetingapp, and there's no saved copy on this phone yet. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Change place" })).toBeOnTheScreen();
  });

  it("reads the search again when the app comes back after the reuse window", async () => {
    const playAppState = spyOnAppState();
    setNow("2026-10-05T20:00:00Z");
    api.reply(SEARCH, { meetings: [near] });
    await launch();
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    setNow("2026-10-05T21:20:00Z");
    api.reply(SEARCH, { meetings: [far, near] });
    await playAppState("background");
    await playAppState("active");
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    expect(searches()).toHaveLength(2);
    // The tag list is read again on the same return; let it land before the test ends.
    await waitFor(async () => {
      expect((await readCache("vocabulary"))?.savedAt).toEqual(new Date("2026-10-05T21:20:00Z"));
    });
  });
});
