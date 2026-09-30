import path from "node:path";

import { renderRouter } from "expo-router/testing-library";

import { CLOCK_ONLY } from "./clock";

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
