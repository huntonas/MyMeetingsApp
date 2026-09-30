import path from "node:path";

import { BRAND, SemVer } from "@mymeetingapp/shared";
import { render, screen, waitFor } from "@testing-library/react-native";
import { z } from "zod";

import { AppText } from "@/ui/app-text";

import appConfig from "../app.config";
import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CONFIG, VOCABULARY } from "./fixtures";
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
  android: z.object({ package: z.string() }),
});

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

  it("keeps its version parseable as the semantic version appVersion() expects (owner ruling M3)", () => {
    const config = Config.parse(appConfig(CONTEXT));
    expect(SemVer.safeParse(config.version).success).toBe(true);
  });
});
