import { serverUrl } from "@/config/server-url";

const PRODUCTION = "https://mymeetingapp.vercel.app";
const STAGING = "https://mymeetingapp-staging.vercel.app";

// __DEV__ is declared a constant, so it is set through Reflect and put back after each test.
const DEV = __DEV__;
afterEach(() => {
  Reflect.set(globalThis, "__DEV__", DEV);
});

function pointAt(url: string, devBuild: boolean) {
  jest.replaceProperty(process.env, "EXPO_PUBLIC_SERVER_URL", url);
  Reflect.set(globalThis, "__DEV__", devBuild);
}

// Metro inlines EXPO_PUBLIC_SERVER_URL from apps/mobile/.env into a dev build, and dev builds add and delete tags.
describe("the server a build talks to", () => {
  it.each([
    PRODUCTION,
    `${PRODUCTION}/`,
    "HTTPS://MyMeetingApp.vercel.app",
    "http://mymeetingapp.vercel.app",
  ])("is never production in a dev build (%s)", (url) => {
    pointAt(url, true);
    expect(() => serverUrl()).toThrow(
      "A dev build never talks to production (it adds and deletes tags). Set EXPO_PUBLIC_SERVER_URL in apps/mobile/.env to https://mymeetingapp-staging.vercel.app or your Mac's LAN address.",
    );
  });

  it("is staging in a dev build when .env says so", () => {
    pointAt(STAGING, true);
    expect(serverUrl()).toBe(STAGING);
  });

  it("is production in a store build", () => {
    pointAt(PRODUCTION, false);
    expect(serverUrl()).toBe(PRODUCTION);
  });
});
