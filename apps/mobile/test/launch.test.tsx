import { cleanup, fireEvent, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { writeCache } from "@/cache/store";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CONFIG } from "./fixtures";
import { setAppVersion } from "./native/expo-application";
import { renderApp } from "./render-app";

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
});
afterEach(async () => {
  await api.close();
});

const tooOld = { ...CONFIG, minSupportedVersion: { ios: "0.2.0", android: "0.2.0" } };

describe("forced upgrade", () => {
  it("replaces searching with the upgrade notice below the minimum version", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    api.reply("/api/v1/config", tooOld);
    await renderApp("/");
    expect(await screen.findByText("Please update mymeetingapp")).toBeOnTheScreen();
    expect(screen.queryByText("Search by city, zip code or address, or use your location.")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Update the app" }));
    expect(openURL).toHaveBeenCalledWith("http://127.0.0.1:3197/");
  });

  it("keeps Saved and Me working while the upgrade is required", async () => {
    api.reply("/api/v1/config", tooOld);
    await renderApp("/saved");
    expect(await screen.findByText("Meetings you save appear here.")).toBeOnTheScreen();
    await cleanup();
    await renderApp("/me");
    expect(await screen.findByText("Your sobriety counter and help live here.")).toBeOnTheScreen();
  });

  it("still requires the upgrade offline, from the last config the phone saw", async () => {
    await writeCache("config", tooOld);
    await api.close();
    await renderApp("/online");
    expect(await screen.findByText("Please update mymeetingapp")).toBeOnTheScreen();
    api = await startApi();
  });

  it("lets a current version search, and doesn't block when the config can't be read", async () => {
    await api.close();
    await renderApp("/");
    expect(
      await screen.findByText("Search by city, zip code or address, or use your location."),
    ).toBeOnTheScreen();
    api = await startApi();
  });

  it("compares the installed version", async () => {
    setAppVersion("0.2.0");
    api.reply("/api/v1/config", tooOld);
    await renderApp("/");
    expect(
      await screen.findByText("Search by city, zip code or address, or use your location."),
    ).toBeOnTheScreen();
  });
});

describe("Help now", () => {
  it("is in every tab's header and opens the crisis lines", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    api.reply("/api/v1/config", CONFIG);
    await renderApp("/me");
    await fireEvent.press(await screen.findByRole("button", { name: "Help now: crisis lines" }));
    expect(await screen.findByText("988 Suicide & Crisis Lifeline")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Call 988" }));
    expect(openURL).toHaveBeenCalledWith("tel:988");
    await fireEvent.press(screen.getByRole("button", { name: "Text 988" }));
    expect(openURL).toHaveBeenCalledWith("sms:988");
    await fireEvent.press(screen.getByRole("button", { name: "Call SAMHSA" }));
    expect(openURL).toHaveBeenCalledWith("tel:18006624357");
  });

  it("is on the upgrade notice too", async () => {
    api.reply("/api/v1/config", tooOld);
    await renderApp("/");
    expect(await screen.findByText("SAMHSA National Helpline")).toBeOnTheScreen();
  });

  it("has buttons at least 44 points tall", async () => {
    api.reply("/api/v1/config", CONFIG);
    await renderApp("/help");
    expect(await screen.findByRole("button", { name: "Call 988" })).toHaveStyle({
      minHeight: 44,
      minWidth: 44,
    });
  });
});
