import path from "node:path";

import { BRAND } from "@mymeetingapp/shared";
import { render, screen } from "@testing-library/react-native";
import { z } from "zod";

import { AppText } from "@/ui/app-text";

import appConfig from "../app.config";
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
  ios: z.object({ bundleIdentifier: z.string() }),
  android: z.object({ package: z.string() }),
});

describe("the app shell", () => {
  it("opens on Nearby, with the four tabs", async () => {
    const app = await renderApp("/");
    for (const tab of ["Nearby", "Online", "Saved", "Me"]) {
      expect(await screen.findByLabelText(tab)).toBeOnTheScreen();
    }
    expect(screen.getByText("Search by city, zip code or address, or use your location.")).toBeOnTheScreen();
    expect(app.getPathname()).toBe("/");
  });

  it("keeps timers real once the app has rendered, so a screen can wait on the network", async () => {
    await renderApp("/");
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
});
