import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { z } from "zod";

import { readCache } from "@/cache/store";
import { type MapRegion, radiusForRegion, regionAround } from "@/location/geo";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, nearbyMeeting, VOCABULARY } from "./fixtures";
import { permissionRequests, setDevicePosition, setLocationPermission } from "./native/expo-location";
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
  day: 1,
  time: "18:30",
  latitude: 35.81,
  longitude: -83.91,
});
const ridge = nearbyMeeting({
  id: "55555555-5555-4555-8555-555555555555",
  name: "Ridge Group",
  day: 1,
  time: "12:00",
  latitude: 35.91,
  longitude: -84.11,
});

// 35.8012, -83.9021 rounds to 35.8, -83.9; a 0.2 × 0.3 degree view there is 18 km from its center to a corner.
const PAN: MapRegion = { latitude: 35.8012, longitude: -83.9021, latitudeDelta: 0.2, longitudeDelta: 0.3 };
const PAN_BODY = { lat: 35.8, lng: -83.9, radiusKm: 18 };
const FIRST_BODY = { lat: 35.76, lng: -83.97, radiusKm: 25 };
const MARYVILLE_POINT = { latitude: 35.7565, longitude: -83.9705 };
const RIDGE: MapRegion = { latitude: 35.9, longitude: -84.1, latitudeDelta: 0.2, longitudeDelta: 0.3 };
const RIDGE_BODY = { lat: 35.9, lng: -84.1, radiusKm: 18 };

// Filters start as today, from now on: early on a Monday morning (Chicago, the suite's zone), every Monday meeting from
// then on is in view. A test about other days or times sets its own.
const MONDAY_EARLY_MORNING = "2026-10-05T10:30:00Z";

beforeEach(async () => {
  setNow(MONDAY_EARLY_MORNING);
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  api.reply(SEARCH, { meetings: [far, near, unplaced, halfPlaced] });
  setPlace("Maryville, TN", MARYVILLE_POINT);
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

type Node = MapElement | string;
const outline = (node: Node): unknown =>
  typeof node === "string" ? node : [node.type, ...node.children.map(outline)];

// Everything in the column the map shares with the rest of the screen, other than the map's own area. The map
// stretches to fill what they leave, so if any of it changes, the map changes size.
function besideMap() {
  let area = screen.getByTestId("results-map");
  while (area.parent !== null && within(area.parent).queryByRole("button", { name: "Change place" }) === null)
    area = area.parent;
  const column = area.parent;
  if (column === null) throw new Error("the map isn't on a screen");
  return column.children.filter((child) => child !== area).map(outline);
}

// Opens the filters panel, unless it's open already.
async function openFilters() {
  const closed = screen.queryByRole("button", { name: /^Filters/, expanded: false });
  if (closed !== null) await fireEvent.press(closed);
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
    expect(await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" })).toBeOnTheScreen();
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
    await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" });
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

  // Apple Maps reports a new region whenever the map's frame changes size (not a gesture, and isGesture is always
  // false there). Taking that as the person's pan fed a loop: search, the screen changes around the map, the map
  // resizes, another search.
  it("searches once per touch: a region report with no new touch, such as a resize, doesn't search", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" });
    await fireEvent(map, "regionChangeComplete", { ...PAN, latitudeDelta: 0.17 });
    await waitForSearchesToSettle();
    expect(searchBodies()).toEqual([FIRST_BODY, PAN_BODY]);
    expect(screen.getByRole("button", { name: "Hill Group, Mon 6:30 PM" })).toBeOnTheScreen();
  });

  // MapKit can report a region while the fingers are still down, when a pinch or drag pauses; the report as they lift
  // must still search.
  it("searches for where a gesture ends after a report mid-gesture", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await fireEvent(map, "touchStart");
    await fireEvent(map, "regionChangeComplete", PAN);
    await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" });
    api.reply(SEARCH, { meetings: [ridge] });
    await fireEvent(map, "touchMove");
    await fireEvent(map, "regionChangeComplete", RIDGE);
    expect(await screen.findByRole("button", { name: "Ridge Group, Mon 12:00 PM" })).toBeOnTheScreen();
    expect(searchBodies()).toEqual([FIRST_BODY, PAN_BODY, RIDGE_BODY]);
  });

  // Tapping a marker, or the map, touches it without moving it; the region report that can follow (the map making
  // room for a callout) isn't the person's.
  it.each(["markerPress", "press"])("doesn't search for a region report after a tap (%s)", async (tap) => {
    const { map } = await openMap();
    await fireEvent(map, "touchStart");
    await fireEvent(map, tap);
    await fireEvent(map, "regionChangeComplete", PAN);
    await waitForSearchesToSettle();
    expect(searchBodies()).toEqual([FIRST_BODY]);
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
  });

  it("lays out nothing around the map that comes or goes with a search, so the map never resizes", async () => {
    const { map } = await openMap();
    const answerPan = api.answerLater(SEARCH);
    await moveTo(map, PAN);
    expect(await screen.findByLabelText("Searching")).toBeOnTheScreen();
    const whileLoading = besideMap();
    answerPan({ meetings: [] });
    expect(
      await screen.findByText("No in-person meetings within 11 miles of this map area."),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText("Searching")).toBeNull();
    expect(besideMap()).toEqual(whileLoading);
  });

  // Opening the filters is the person's doing, but Apple Maps would still report the resize as a new region, so the
  // open panel sits on the layer over the map and the map keeps its size.
  it("opens the filters over the map, without resizing it or searching", async () => {
    const { map } = await openMap();
    const before = JSON.stringify(besideMap());
    const toggle = screen.getByRole("button", { name: "Filters, 2 chosen" });
    expect(toggle).toHaveProp("accessibilityHint", "Shows the filters");
    await fireEvent.press(toggle);
    expect(screen.getByRole("button", { name: "Filters, 2 chosen" })).toHaveProp("accessibilityState", {
      expanded: true,
    });
    const day = screen.getByRole("button", { name: "Day filters, 1 chosen" });
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear).toHaveProp("accessibilityHint", "Clears the filters, to show every meeting");
    // The map isn't sorted.
    expect(screen.queryByRole("button", { name: "Sort soonest first" })).toBeNull();
    let layer = day;
    while (layer.parent !== null && layer.parent !== map.parent) layer = layer.parent;
    expect(layer).toHaveStyle({ position: "absolute", zIndex: 1 });
    // Only the toggle's arrow changes beside the map.
    expect(JSON.stringify(besideMap())).toBe(before.replace("▾", "▴"));
    // Even if the map reported a region now, untouched, it isn't a pan.
    await fireEvent(map, "regionChangeComplete", {
      ...regionAround(MARYVILLE_POINT, 25),
      latitudeDelta: 0.3,
    });
    await fireEvent.press(screen.getByRole("button", { name: "Filters, 2 chosen" }));
    expect(screen.queryByRole("button", { name: "Day filters, 1 chosen" })).toBeNull();
    expect(JSON.stringify(besideMap())).toBe(before);
    await waitForSearchesToSettle();
    expect(searchBodies()).toEqual([FIRST_BODY]);
    expect(screen.getByTestId("results-map")).toBe(map);
  });

  it("keeps the last markers on the map while a pan's search loads", async () => {
    const { map } = await openMap();
    const answerPan = api.answerLater(SEARCH);
    await moveTo(map, PAN);
    expect(await screen.findByLabelText("Searching")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    answerPan({ meetings: [hill] });
    expect(await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" })).toBeOnTheScreen();
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
    await openFilters();
    await fireEvent.press(screen.getByRole("button", { name: "Day filters, 1 chosen" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Monday" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Tuesday" }));
    await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    expect(await screen.findByText("No meetings match your filters.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.queryByText("No meetings match your filters.")).toBeNull();
    expect(screen.getByTestId("results-map")).toBeOnTheScreen();
  });

  it("late in the day with nothing left, says so rather than blaming filters the person didn't choose", async () => {
    // Monday 10 PM: both groups began hours ago.
    setNow("2026-10-06T03:00:00Z");
    await launchNearby();
    await fireEvent.changeText(await screen.findByLabelText("Search for a place"), "Maryville, TN");
    await fireEvent.press(screen.getByRole("button", { name: "Search" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Map" }));
    expect(await screen.findByText("No more meetings nearby today.")).toBeOnTheScreen();
    expect(screen.queryByText("No meetings match your filters.")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.queryByText("No more meetings nearby today.")).toBeNull();
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
    expect(await screen.findByRole("button", { name: "Ridge Group, Mon 12:00 PM" })).toBeOnTheScreen();
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
    await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" });
    await fireEvent.press(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByText("Hill Group")).toBeOnTheScreen();
    expect(screen.queryByTestId("results-map")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    expect(await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" })).toBeOnTheScreen();
    expect(mapProps().initialRegion).toEqual(PAN);
    expect(searchBodies()).toEqual([FIRST_BODY, PAN_BODY]);
  });

  it("shows only the meetings that match the filters", async () => {
    await openMap();
    await openFilters();
    await fireEvent.press(screen.getByRole("button", { name: "Time filters, 4 chosen" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Morning" }));
    await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Near Group, Mon 8:00 AM" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.getByTestId("results-map")).toBeOnTheScreen();
  });

  it("leaves out today's meetings that began over an hour ago, as the list does, until the person changes the day or time", async () => {
    const smallHours = nearbyMeeting({
      id: "77777777-7777-4777-8777-777777777777",
      name: "Small Hours Group",
      day: 1,
      time: "00:30",
      latitude: 35.76,
      longitude: -83.97,
    });
    const lateTonight = {
      ...smallHours,
      id: "88888888-8888-4888-8888-888888888888",
      name: "Late Group",
      time: "23:00",
    };
    // Monday 10 PM.
    setNow("2026-10-06T03:00:00Z");
    api.reply(SEARCH, { meetings: [smallHours, lateTonight] });
    await launchNearby();
    await fireEvent.changeText(await screen.findByLabelText("Search for a place"), "Maryville, TN");
    await fireEvent.press(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Late Group");
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    expect(await screen.findByRole("button", { name: "Late Group, Mon 11:00 PM" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Small Hours Group, Mon 12:30 AM" })).toBeNull();
    await openFilters();
    await fireEvent.press(screen.getByRole("button", { name: "Type filters" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Open" }));
    await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    expect(await screen.findByRole("button", { name: "Type filters, 1 chosen" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Late Group, Mon 11:00 PM" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Small Hours Group, Mon 12:30 AM" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Day filters, 1 chosen" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Tuesday" }));
    await fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    expect(await screen.findByRole("button", { name: "Small Hours Group, Mon 12:30 AM" })).toBeOnTheScreen();
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

describe("going back after moving the map", () => {
  const backTo = (name: string) => screen.getByRole("button", { name: `Back to ${name}` });

  it("returns to the searched place: its heading, its search and its view", async () => {
    const { map } = await openMap();
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    // The pan's answer replaces the place's saved copy (only the last search is kept), so going back asks again.
    expect(await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" })).toBeOnTheScreen();
    expect(screen.getByText("Near this map area")).toBeOnTheScreen();
    expect(backTo("Maryville, TN")).toHaveProp("accessibilityHint", "Searches near Maryville, TN again");
    api.reply(SEARCH, { meetings: [far, near] });
    await fireEvent.press(backTo("Maryville, TN"));
    expect(await screen.findByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
    expect(searchBodies()).toEqual([FIRST_BODY, PAN_BODY, FIRST_BODY]);
    const { initialRegion } = mapProps();
    expect(initialRegion.latitude).toBe(35.7565);
    expect(initialRegion.longitude).toBe(-83.9705);
    expect(initialRegion.latitudeDelta).toBeCloseTo(0.4492, 4);
    // The map comes back around the place; its first region report, with no touch, is not a pan.
    await fireEvent(screen.getByTestId("results-map"), "regionChangeComplete", PAN);
    await waitForSearchesToSettle();
    expect(searchBodies()).toEqual([FIRST_BODY, PAN_BODY, FIRST_BODY]);
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
  });

  it("goes back to where the search was before the first pan, however many pans since", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" });
    api.reply(SEARCH, { meetings: [ridge] });
    await moveTo(map, { latitude: 35.9, longitude: -84.1, latitudeDelta: 0.2, longitudeDelta: 0.3 });
    await screen.findByRole("button", { name: "Ridge Group, Mon 12:00 PM" });
    api.reply(SEARCH, { meetings: [far] });
    await fireEvent.press(backTo("Maryville, TN"));
    expect(await screen.findByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(searchBodies().at(-1)).toEqual(FIRST_BODY);
  });

  it("is offered in the list too, under the heading", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" });
    await fireEvent.press(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByText("Hill Group")).toBeOnTheScreen();
    api.reply(SEARCH, { meetings: [far] });
    await fireEvent.press(backTo("Maryville, TN"));
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(searchBodies().at(-1)).toEqual(FIRST_BODY);
  });

  // Anything appearing beside the map would resize it, and Apple Maps reports a resize as a new region.
  it("sits over the map, so appearing after the first pan never resizes it", async () => {
    const { map } = await openMap();
    const beforePan = JSON.stringify(besideMap());
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Back to Maryville, TN" });
    await waitForSearchesToSettle();
    // Only the heading's words change.
    expect(JSON.stringify(besideMap())).toBe(beforePan.replace("Near Maryville, TN", "Near this map area"));
  });

  // VoiceOver and TalkBack read in the order of the tree, so the layer over the map comes before the map's markers,
  // and draws on top by its zIndex.
  it("is read before the map's markers, and drawn over the map", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" });
    const buttons = screen.getAllByRole("button").map((button) => String(button.props.accessibilityLabel));
    expect(buttons.indexOf("Back to Maryville, TN")).toBeGreaterThan(-1);
    expect(buttons.indexOf("Back to Maryville, TN")).toBeLessThan(buttons.indexOf("Hill Group, Mon 6:30 PM"));
    let layer = backTo("Maryville, TN");
    while (layer.parent !== null && layer.parent !== map.parent) layer = layer.parent;
    expect(layer).toHaveStyle({ position: "absolute", zIndex: 1 });
  });

  it("is forgotten when the person searches a new place", async () => {
    setPlace("Knoxville, TN", { latitude: 35.9606, longitude: -83.9207 });
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Back to Maryville, TN" });
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.changeText(await screen.findByLabelText("Search for a place"), "Knoxville, TN");
    await fireEvent.press(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Near Knoxville, TN")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
    api.reply(SEARCH, { meetings: [ridge] });
    await moveTo(await screen.findByTestId("results-map"), PAN);
    expect(await screen.findByRole("button", { name: "Back to Knoxville, TN" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Back to Maryville, TN" })).toBeNull();
  });

  it("returns to a search near the person as near you", async () => {
    setLocationPermission("granted");
    await launchNearby();
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(await screen.findByTestId("results-map"), PAN);
    expect(await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" })).toBeOnTheScreen();
    expect(backTo("near you")).toHaveProp("accessibilityHint", "Searches near you again");
    // The person has since moved, from Nashville to Murfreesboro: near them means where they are now.
    setDevicePosition({ latitude: 35.8456, longitude: -86.3903 });
    api.reply(SEARCH, { meetings: [far] });
    await fireEvent.press(backTo("near you"));
    expect(await screen.findByText("Near you")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(searchBodies()).toEqual([
      { lat: 36.16, lng: -86.78, radiusKm: 25 },
      PAN_BODY,
      { lat: 35.85, lng: -86.39, radiusKm: 25 },
    ]);
    expect(mapProps().showsUserLocation).toBe(true);
    expect(permissionRequests()).toBe(0);
  });
});

describe("going back near the person when the phone can't find itself", () => {
  const UNAVAILABLE = "We couldn't get your location just now. Try again, or search by place.";

  async function panAwayFromThePerson() {
    setLocationPermission("granted");
    await launchNearby();
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Map" }));
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(await screen.findByTestId("results-map"), PAN);
    expect(await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" })).toBeOnTheScreen();
    setDevicePosition("fails");
  }

  it("says so over the map, and keeps the map area", async () => {
    await panAwayFromThePerson();
    const map = screen.getByTestId("results-map");
    const beforeBack = JSON.stringify(besideMap());
    await fireEvent.press(screen.getByRole("button", { name: "Back to near you" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(UNAVAILABLE);
    expect(screen.getByText("Near this map area")).toBeOnTheScreen();
    expect(screen.getByTestId("results-map")).toBe(map);
    // On the layer over the map, so it doesn't resize it.
    expect(JSON.stringify(besideMap())).toBe(beforeBack);
    expect(searchBodies()).toEqual([{ lat: 36.16, lng: -86.78, radiusKm: 25 }, PAN_BODY]);
    // The next pan is a new request; the old failure no longer applies.
    await moveTo(map, RIDGE);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("says so under the heading in the list, and Change place doesn't carry it over", async () => {
    await panAwayFromThePerson();
    await fireEvent.press(screen.getByRole("button", { name: "List" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Back to near you" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(UNAVAILABLE);
    expect(screen.getByText("Hill Group")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    expect(await screen.findByLabelText("Search for a place")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
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
  it("offline, a pan's search shows the last search, named by its place, and keeps the map", async () => {
    setNow("2026-10-05T20:40:00Z");
    const { map } = await openMap();
    api.reply(SEARCH, { problem: "not the API's error envelope" }, 500);
    await moveTo(map, PAN);
    expect(
      await screen.findByText(
        "Showing your last search, near Maryville, TN, saved today at 3:40 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.getByTestId("results-map")).toBe(map);
  });

  it("offline, names a last search made by panning as the map area searched, not this one", async () => {
    setNow("2026-10-05T20:40:00Z");
    const { map } = await openMap();
    api.reply(SEARCH, { meetings: [hill] });
    await moveTo(map, PAN);
    await screen.findByRole("button", { name: "Hill Group, Mon 6:30 PM" });
    api.reply(SEARCH, { problem: "not the API's error envelope" }, 500);
    await moveTo(map, { latitude: 35.91, longitude: -84.11, latitudeDelta: 0.2, longitudeDelta: 0.3 });
    expect(
      await screen.findByText(
        "Showing your last search, near the map area you searched, saved today at 3:40 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("Near the map area you searched")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Hill Group, Mon 6:30 PM" })).toBeOnTheScreen();
  });

  it("says so when a pan's search fails with the server in trouble, and keeps the map", async () => {
    const { map } = await openMap();
    api.reply(SEARCH, { error: { code: "server_error", message: "Something went wrong on our end." } }, 500);
    await moveTo(map, PAN);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our end.");
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
