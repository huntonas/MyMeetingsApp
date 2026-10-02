import { readFileSync } from "node:fs";
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
  owner: z.string(),
  extra: z.object({ eas: z.object({ projectId: z.string() }) }),
  version: z.string(),
  icon: z.string(),
  ios: z.object({
    bundleIdentifier: z.string(),
    config: z.object({ usesNonExemptEncryption: z.boolean() }),
    infoPlist: z.object({
      NSLocationTemporaryUsageDescriptionDictionary: z.object({ AttendanceCheck: z.string() }),
    }),
  }),
  android: z.object({
    package: z.string(),
    permissions: z.array(z.string()),
    blockedPermissions: z.array(z.string()),
    adaptiveIcon: z.object({
      foregroundImage: z.string(),
      monochromeImage: z.string(),
      backgroundColor: z.string(),
    }),
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
      motionUsagePermission: z.string(),
    })
    .strict(),
]);

// react-native-maps' config plugin options. iOS uses Apple Maps, which needs no key; only Android's Google Maps does.
const MapsPlugin = z.tuple([
  z.literal("react-native-maps"),
  z.object({ androidGoogleMapsApiKey: z.string().optional() }).strict(),
]);

// expo-splash-screen's config plugin options: the native launch screen's image, its width in points, and background.
const SplashPlugin = z.tuple([
  z.literal("expo-splash-screen"),
  z.object({ image: z.string(), imageWidth: z.number(), backgroundColor: z.string() }).strict(),
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

  it("follows the system's dark appearance with the website's dark tokens and the bundled font", async () => {
    await render(<AppText variant="label">Welcoming</AppText>);
    expect(screen.getByText("Welcoming")).toHaveStyle({
      color: "#eceff1",
      fontFamily: "AtkinsonHyperlegible-Bold",
    });
  });
});

describe("test harness, not app behaviour: renderApp (test/render-app.tsx)", () => {
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
});

// A PNG's IHDR: width and height at bytes 16 and 20, colour type at byte 25 (2 = RGB, 6 = RGB with alpha).
function png(relative: string) {
  const bytes = readFileSync(path.join(CONTEXT.projectRoot, relative));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

describe("the app config", () => {
  it("ships a 1024-pixel square icon with no transparency, as the App Store requires", () => {
    expect(png(Config.parse(appConfig(CONTEXT)).icon)).toEqual({ width: 1024, height: 1024, colourType: 2 });
  });

  it("draws the Android adaptive icon and the splash as the mark on the accent blue", () => {
    const config = Config.parse(appConfig(CONTEXT));
    const { foregroundImage, monochromeImage, backgroundColor } = config.android.adaptiveIcon;
    expect(backgroundColor).toBe("#1f5f8b");
    expect(monochromeImage).toBe(foregroundImage);
    expect(png(foregroundImage)).toEqual({ width: 1024, height: 1024, colourType: 6 });
    const [, splash] = SplashPlugin.parse(
      config.plugins.find((plugin) => plugin[0] === "expo-splash-screen"),
    );
    expect(splash).toEqual({ image: foregroundImage, imageWidth: 200, backgroundColor: "#1f5f8b" });
  });

  it("names the app from the brand, with the owner's bundle identifier", () => {
    const config = Config.parse(appConfig(CONTEXT));
    expect(config.name).toBe(BRAND.appName);
    expect(config.ios.bundleIdentifier).toBe("com.goodersoftware.mymeetingapp");
    expect(config.android.package).toBe("com.goodersoftware.mymeetingapp");
  });

  it("builds under the huntonas Expo account, whose login also belongs to another account", () => {
    expect(Config.parse(appConfig(CONTEXT)).owner).toBe("huntonas");
  });

  it("is linked to its EAS project, @huntonas/mymeetingapp", () => {
    expect(Config.parse(appConfig(CONTEXT)).extra.eas.projectId).toBe("14727d21-7124-463d-a886-96e058058e1a");
  });

  it("declares no non-exempt encryption, so TestFlight uploads skip the compliance question", () => {
    const config = Config.parse(appConfig(CONTEXT));
    expect(config.ios.config).toEqual({ usesNonExemptEncryption: false });
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
    expect(options.locationWhenInUsePermission).toContain("rounded to about 1 km");
    // Spec §8: the attendance check uses the same permission, so its purpose string names it too.
    expect(options.locationWhenInUsePermission).toContain("check you're near a meeting you tag");
  });

  // Apple rejects an upload whose code could reach motion data without a purpose string (ITMS-90683, TestFlight build
  // 2), even though the app never asks for it; the string says so plainly.
  it("carries an honest motion purpose string, saying the app never uses motion data", () => {
    const config = Config.parse(appConfig(CONTEXT));
    const [, options] = LocationPlugin.parse(config.plugins.find((plugin) => plugin[0] === "expo-location"));
    expect(options.motionUsagePermission).toMatch(new RegExp(`^${BRAND.appName} `));
    expect(options.motionUsagePermission).toContain("never");
  });

  it("explains the attendance check's one-time request for full accuracy (spec §8, §11)", () => {
    const config = Config.parse(appConfig(CONTEXT));
    expect(config.ios.infoPlist.NSLocationTemporaryUsageDescriptionDictionary.AttendanceCheck).toBe(
      "mymeetingapp checks that you're near the meeting, to stop spam, while the app is open. Your location never leaves your phone.",
    );
  });

  it("takes the Android Google Maps key from the build's environment, and ships none of its own", () => {
    const mapsKey = () => {
      const config = Config.parse(appConfig(CONTEXT));
      return MapsPlugin.parse(config.plugins.find((plugin) => plugin[0] === "react-native-maps"))[1]
        .androidGoogleMapsApiKey;
    };
    jest.replaceProperty(process, "env", { ...process.env, GOOGLE_MAPS_ANDROID_API_KEY: undefined });
    expect(mapsKey()).toBeUndefined();
    jest.replaceProperty(process, "env", { ...process.env, GOOGLE_MAPS_ANDROID_API_KEY: "key-from-eas" });
    expect(mapsKey()).toBe("key-from-eas");
  });

  it("keeps its version parseable as the semantic version installedVersion() expects (owner ruling M3)", () => {
    const config = Config.parse(appConfig(CONTEXT));
    expect(SemVer.safeParse(config.version).success).toBe(true);
  });
});
