import path from "node:path";

import { BRAND, SemVer } from "@mymeetingapp/shared";
import { render, screen, waitFor } from "@testing-library/react-native";
import { z } from "zod";

import { AppText } from "@/ui/app-text";

import appConfig from "../app.config";
import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CONFIG, VOCABULARY } from "./fixtures";
import { permissionRequests, positionReads } from "./native/expo-location";
import { renderApp } from "./render-app";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => "dark",
}));

const CONTEXT = {
  projectRoot: path.join(__dirname, ".."),
  staticConfigPath: null,
  packageJsonPath: null,
  config: {},
};

const Config = z.object({
  name: z.string(),
  version: z.string(),
  ios: z.object({ bundleIdentifier: z.string() }),
  android: z.object({
    package: z.string(),
    permissions: z.array(z.string()),
    blockedPermissions: z.array(z.string()),
  }),
  plugins: z.array(z.union([z.string(), z.tuple([z.string(), z.unknown()])])),
});

// expo-location's config plugin options: `false` removes that iOS purpose string; the background switches default off.
const LocationPlugin = z.tuple([
  z.literal("expo-location"),
  z
    .object({
      locationWhenInUsePermission: z.string(),
      locationAlwaysAndWhenInUsePermission: z.literal(false),
      locationAlwaysPermission: z.literal(false),
      motionUsagePermission: z.literal(false),
    })
    .strict(),
]);

// Launch reads the config and the tag list.
const LAUNCH_READS = 2;

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
});

afterEach(async () => {
  await api.close();
});

describe("the app shell", () => {
  // First in the file, so it also catches a request made when a module is first loaded.
  it("asks for no location permission at launch (spec §2)", async () => {
    await renderApp("/");
    await waitFor(() => {
      expect(api.requests).toHaveLength(LAUNCH_READS);
    });
    expect(await screen.findByLabelText("Nearby")).toBeOnTheScreen();
    expect(permissionRequests()).toBe(0);
    expect(positionReads()).toBe(0);
  });

  it("opens on Nearby, with the four tabs", async () => {
    const app = await renderApp("/");
    await waitFor(() => {
      expect(api.requests).toHaveLength(LAUNCH_READS);
    });
    for (const tab of ["Nearby", "Online", "Saved", "Me"]) {
      expect(await screen.findByLabelText(tab)).toBeOnTheScreen();
    }
    expect(screen.getByText("Search by city, zip code or address, or use your location.")).toBeOnTheScreen();
    expect(app.getPathname()).toBe("/");
  });

  it("keeps timers real once the app has rendered, so a screen can wait on the network", async () => {
    await renderApp("/");
    await waitFor(() => {
      expect(api.requests).toHaveLength(LAUNCH_READS);
    });
    const fired = await new Promise<boolean>((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, 10),
    );
    expect(fired).toBe(true);
  }, 1000);

  it("follows the system's dark appearance with the website's dark tokens and the bundled font", async () => {
    await render(<AppText variant="label">Welcoming</AppText>);
    expect(screen.getByText("Welcoming")).toHaveStyle({
      color: "#eceff1",
      fontFamily: "AtkinsonHyperlegible-Bold",
    });
  });
});

describe("the app config", () => {
  it("names the app from the brand, with the owner's bundle identifier", () => {
    const config = Config.parse(appConfig(CONTEXT));
    expect(config.name).toBe(BRAND.appName);
    expect(config.ios.bundleIdentifier).toBe("com.goodersoftware.mymeetingapp");
    expect(config.android.package).toBe("com.goodersoftware.mymeetingapp");
  });

  it("asks only for While Using location, never in the background (spec §2, §11)", () => {
    const config = Config.parse(appConfig(CONTEXT));
    expect(config.android.permissions).toEqual([
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ]);
    expect(config.android.blockedPermissions).toContain("android.permission.ACCESS_BACKGROUND_LOCATION");
    const [, options] = LocationPlugin.parse(config.plugins.find((plugin) => plugin[0] === "expo-location"));
    expect(options.locationWhenInUsePermission).toMatch(new RegExp(`^${BRAND.appName} `));
    expect(options.locationWhenInUsePermission).toContain("rounds it to about 1 km");
  });

  it("keeps its version parseable as the semantic version appVersion() expects (owner ruling M3)", () => {
    const config = Config.parse(appConfig(CONTEXT));
    expect(SemVer.safeParse(config.version).success).toBe(true);
  });
});
