import path from "node:path";

import { waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

import { readCache } from "@/cache/store";

import { CLOCK_ONLY } from "./clock";
import { permissionChecks } from "./native/expo-location";

const APP_DIR = path.join(__dirname, "..", "src", "app");

// Renders the real app directory, so tests drive the screens and navigation users get. renderRouter fakes every
// timer; once the first render settles, only the clock stays fake (at the same moment), so network waits run in
// real time.
export async function renderApp(initialUrl = "/") {
  const rendered = renderRouter(APP_DIR, { initialUrl });
  await rendered;
  jest.useFakeTimers({ ...CLOCK_ONLY, now: Date.now() });
  return { getPathname: () => rendered.getPathname() };
}

// Opens Nearby and waits for launch to settle (the config and tag list read and saved, and Nearby's look at whether
// location was allowed), so nothing from launch lands in the middle of what a test does next.
export async function launchNearby() {
  const app = await renderApp("/");
  await waitFor(async () => {
    expect(await readCache("config")).not.toBeNull();
    expect(await readCache("vocabulary")).not.toBeNull();
    expect(permissionChecks()).toBeGreaterThan(0);
  });
  return app;
}

// For a screen with no tag chips to wait on: launch's reads (the config and the tag list) have landed, so nothing
// from launch updates the screen after the test ends.
export async function launchReadsLanded() {
  await waitFor(async () => {
    expect(await readCache("config")).not.toBeNull();
    expect(await readCache("vocabulary")).not.toBeNull();
  });
}
