import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { z } from "zod";

import { readCache } from "@/cache/store";
import { type MapRegion, radiusForRegion, regionAround } from "@/location/geo";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, nearbyMeeting, VOCABULARY } from "./fixtures";
import { permissionRequests, setLocationPermission } from "./native/expo-location";
import { setPlace } from "./native/native-location";
import { launchNearby } from "./render-app";

let api: TestApi;
const SEARCH = "/api/v1/meetings/search";
const searchBodies = () =>
  api.requests
    .filter((request) => request.path === SEARCH)
    .map((request) => {
      const body: unknown = JSON.parse(request.body);
      return body;
    });

// What the app handed the map. Host props are untyped, so they're parsed rather than cast.
const MapProps = z.object({
  initialRegion: z.object({
    latitude: z.number(),
    longitude: z.number(),
    latitudeDelta: z.number(),
    longitudeDelta: z.number(),
  }),
  showsUserLocation: z.boolean(),
});
const mapProps = () => MapProps.parse(screen.getByTestId("results-map").props);

const far = nearbyMeeting({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Far Group",
  day: 1,
  time: "19:00",
  latitude: 35.77,
  longitude: -83.99,
});
const near = nearbyMeeting({
  id: "22222222-2222-4222-8222-222222222222",
  name: "Near Group",
  day: 1,
  time: "08:00",
  latitude: 35.7566,
  longitude: -83.9706,
});
const unplaced = nearbyMeeting({
  id: "33333333-3333-4333-8333-333333333333",
  name: "Unplaced Group",
  latitude: null,
  longitude: null,
});
// The contract lets each coordinate be missing on its own.
const halfPlaced = nearbyMeeting({
  id: "66666666-6666-4666-8666-666666666666",
  name: "Half Placed Group",
  latitude: 35.75,
  longitude: null,
});
const hill = nearbyMeeting({
  id: "44444444-4444-4444-8444-444444444444",
  name: "Hill Group",
  day: 2,
  time: "18:30",
  latitude: 35.81,
  longitude: -83.91,
});
const ridge = nearbyMeeting({
  id: "55555555-5555-4555-8555-555555555555",
  name: "Ridge Group",
  day: 3,
  time: "12:00",
  latitude: 35.91,
  longitude: -84.11,
});

// 35.8012, -83.9021 rounds to 35.8, -83.9; a 0.2 × 0.3 degree view there is 18 km from its center to a corner.
const PAN: MapRegion = { latitude: 35.8012, longitude: -83.9021, latitudeDelta: 0.2, longitudeDelta: 0.3 };
const PAN_BODY = { lat: 35.8, lng: -83.9, radiusKm: 18 };
const FIRST_BODY = { lat: 35.76, lng: -83.97, radiusKm: 25 };

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  api.reply(SEARCH, { meetings: [far, near, unplaced, halfPlaced] });
  setPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
});
afterEach(async () => {
  await api.close();
});

async function openMap() {
  const app = await launchNearby();
  await fireEvent.changeText(await screen.findByLabelText("Search for a place"), "Maryville, TN");
  await fireEvent.press(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Far Group");
  await fireEvent.press(screen.getByRole("button", { name: "Map" }));
  return { app, map: await screen.findByTestId("results-map") };
}

type MapElement = Awaited<ReturnType<typeof screen.findByTestId>>;

// The person touches the map, drags or pinches it, and lets go.
async function moveTo(map: MapElement, region: MapRegion) {
  await fireEvent(map, "touchStart");
  await fireEvent(map, "regionChangeComplete", region);
}

async function waitForSearchesToSettle() {
  await waitFor(() => {
    expect(screen.queryByLabelText("Searching")).toBeNull();
  });
}

describe("regionAround", () => {
  it("frames the search radius, and the map's radius covers its corners", () => {
    const region = regionAround({ latitude: 36.16, longitude: -86.78 }, 25);
    expect(region.latitude).toBe(36.16);
    expect(region.longitude).toBe(-86.78);
    expect(region.latitudeDelta).toBeCloseTo(0.4492, 4);
    expect(region.longitudeDelta).toBeCloseTo(0.5563, 4);
    expect(radiusForRegion(region)).toBe(36);
  });
});

describe("the results map", () => {
  it("opens around the searched place with a marker for each placed meeting", async () => {
    await openMap();
    const { initialRegion } = mapProps();
    expect(initialRegion.latitude).toBe(35.7565);
    expect(initialRegion.longitude).toBe(-83.9705);
    expect(initialRegion.latitudeDelta).toBeCloseTo(0.4492, 4);
    expect(initialRegion.longitudeDelta).toBeCloseTo(0.5535, 4);
    expect(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Near Group, Mon 8:00 AM" })).toBeOnTheScreen();
    expect(screen.queryByText("Unplaced Group")).toBeNull();
    expect(screen.queryByText("Half Placed Group")).toBeNull();
    expect(screen.getByRole("button", { name: "Map" })).toBeSelected();
    expect(screen.getByRole("button", { name: "List" })).not.toBeSelected();
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
  });

  it("searches around the new center after a pan, sending only the rounded center, and keeps the view", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    expect(await screen.findByRole("button", { name: "Hill Group, Tue 6:30 PM" })).toBeOnTheScreen();
    expect(screen.getByText("Near this map area")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeNull();
    expect(searchBodies()).toEqual([FIRST_BODY, PAN_BODY]);
    for (const body of searchBodies()) expect(JSON.stringify(body)).not.toMatch(/35\.801|83\.902/);
    // The same map, never remounted by the search, and never handed a region (which would move it): the person's
    // view stays where they put it.
    expect(screen.getByTestId("results-map")).toBe(map);
    expect(map.props).not.toHaveProperty("region");
  });

  it("doesn't search again when the rounded center and radius haven't changed", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Hill Group, Tue 6:30 PM" });
    await moveTo(map, { latitude: 35.8049, longitude: -83.9049, latitudeDelta: 0.2, longitudeDelta: 0.3 });
    await waitForSearchesToSettle();
    expect(searchBodies()).toEqual([FIRST_BODY, PAN_BODY]);
  });

  // Both platforms report the region they fitted to the screen when the map first appears, before anyone touches it.
  it("doesn't search or relabel when the map first appears", async () => {
    const { map } = await openMap();
    await fireEvent(map, "regionChangeComplete", {
      latitude: 35.7565,
      longitude: -83.9705,
      latitudeDelta: 0.64,
      longitudeDelta: 0.5535,
    });
    await waitForSearchesToSettle();
    expect(searchBodies()).toEqual([FIRST_BODY]);
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
  });

  it("keeps the last markers on the map while a pan's search loads", async () => {
    const { map } = await openMap();
    const answerPan = api.answerLater(SEARCH);
    await moveTo(map, PAN);
    expect(await screen.findByLabelText("Searching")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    answerPan({ meetings: [hill] });
    expect(await screen.findByRole("button", { name: "Hill Group, Tue 6:30 PM" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeNull();
  });

  it("says plainly when a map area has no in-person meetings", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [] });
    await moveTo(map, PAN);
    expect(
      await screen.findByText("No in-person meetings within 11 miles of this map area."),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("results-map")).toBe(map);
    expect(screen.queryByText("Online meetings you can join")).toBeNull();
  });

  it("says when no marker matches the filters, and clears them from the map", async () => {
    await openMap();
    await fireEvent.press(screen.getByRole("button", { name: "Day filters" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Tuesday" }));
    await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    expect(await screen.findByText("No meetings match your filters.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.queryByText("No meetings match your filters.")).toBeNull();
    expect(screen.getByTestId("results-map")).toBeOnTheScreen();
  });

  it("keeps the map on screen while a pan's search loads, and a slower earlier search never replaces a newer one", async () => {
    const { map } = await openMap();
    const answerFirstPan = api.answerLater(SEARCH);
    await moveTo(map, PAN);
    expect(await screen.findByLabelText("Searching")).toBeOnTheScreen();
    expect(screen.getByTestId("results-map")).toBe(map);
    await waitFor(() => {
      expect(searchBodies()).toHaveLength(2);
    });
    api.reply(SEARCH, { meetings: [ridge] });
    await moveTo(map, { latitude: 35.9, longitude: -84.1, latitudeDelta: 0.2, longitudeDelta: 0.3 });
    expect(await screen.findByRole("button", { name: "Ridge Group, Wed 12:00 PM" })).toBeOnTheScreen();
    answerFirstPan({ meetings: [hill] });
    // The first pan's answer has arrived and been saved on the phone; it must not take the screen.
    await waitFor(async () => {
      expect(await readCache("search:35.8,-83.9,18")).not.toBeNull();
    });
    await fireEvent.press(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByText("Ridge Group")).toBeOnTheScreen();
    expect(screen.queryByText("Hill Group")).toBeNull();
  });

  it("reopens where the person left it after switching to the list and back", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Hill Group, Tue 6:30 PM" });
    await fireEvent.press(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByText("Hill Group")).toBeOnTheScreen();
    expect(screen.queryByTestId("results-map")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    expect(await screen.findByRole("button", { name: "Hill Group, Tue 6:30 PM" })).toBeOnTheScreen();
    expect(mapProps().initialRegion).toEqual(PAN);
    expect(searchBodies()).toEqual([FIRST_BODY, PAN_BODY]);
  });

  it("shows only the meetings that match the filters", async () => {
    await openMap();
    await fireEvent.press(screen.getByRole("button", { name: "Time filters" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Evening" }));
    await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Near Group, Mon 8:00 AM" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.getByTestId("results-map")).toBeOnTheScreen();
  });

  it("opens a meeting from its marker", async () => {
    api.reply(`/api/v1/meetings/${far.id}`, { meeting: far });
    const { app } = await openMap();
    await fireEvent.press(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" }));
    await waitFor(() => {
      expect(app.getPathname()).toBe("/meeting/11111111-1111-4111-8111-111111111111");
    });
    expect(await screen.findByText("Mondays, 7:00 PM to 1:00 PM")).toBeOnTheScreen();
  });
});

describe("the person's own dot", () => {
  it("isn't shown for a searched place, even after a pan", async () => {
    const { map } = await openMap();
    expect(mapProps().showsUserLocation).toBe(false);
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    expect(await screen.findByText("Near this map area")).toBeOnTheScreen();
    expect(mapProps().showsUserLocation).toBe(false);
  });

  it("is shown for a search near them, and stays through a pan, without any dialog", async () => {
    setLocationPermission("granted");
    await launchNearby();
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    const map = await screen.findByTestId("results-map");
    expect(mapProps().showsUserLocation).toBe(true);
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    expect(await screen.findByText("Near this map area")).toBeOnTheScreen();
    expect(mapProps().showsUserLocation).toBe(true);
    expect(permissionRequests()).toBe(0);
  });
});

describe("the map's notices", () => {
  it("says so when a pan's search fails, and keeps the map", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { problem: "not the API's error envelope" }, 500);
    await moveTo(map, PAN);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach mymeetingapp, and there's no saved copy on this phone yet. Check your connection and try again.",
    );
    expect(screen.getByTestId("results-map")).toBe(map);
    // The earlier area's markers would read as this area's meetings.
    expect(screen.queryByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeNull();
  });

  it("labels a saved copy shown offline", async () => {
    setNow("2026-10-05T20:00:00Z");
    await openMap();
    setNow("2026-10-05T21:20:00Z");
    await api.close();
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(
      await screen.findByText(
        "Showing the copy saved today at 3:00 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    api = await startApi();
  });
});
