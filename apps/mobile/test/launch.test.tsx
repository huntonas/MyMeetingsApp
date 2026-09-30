import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { fetchConfig } from "@/api/reads";
import { readCache, writeCache } from "@/cache/store";

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

// Both cover the "ready" gate: the config has definitely loaded (proven by the cached copy it leaves behind, since
// REUSE_MINUTES.config is 0 and a successful read always saves), not the "loading" render that happens to look the
// same and would pass before the read ever settled.
async function expectNotBlocked() {
  await waitFor(async () => {
    expect(await readCache("config")).not.toBeNull();
  });
  await waitFor(() => {
    expect(screen.queryByText("Please update mymeetingapp")).toBeNull();
    expect(screen.getByText("Search by city, zip code or address, or use your location.")).toBeOnTheScreen();
  });
}

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
    await waitFor(async () => {
      expect(await readCache("config")).not.toBeNull();
    });
    expect(screen.queryByText("Please update mymeetingapp")).toBeNull();
    expect(screen.getByText("Meetings you save appear here.")).toBeOnTheScreen();

    await cleanup();
    // A clean cache forces the Me render's own read to finish (and get saved) before the wait below resolves,
    // rather than reusing the row the Saved render already left behind.
    await resetAppData();
    api.reply("/api/v1/config", tooOld);
    await renderApp("/me");
    await waitFor(async () => {
      expect(await readCache("config")).not.toBeNull();
    });
    expect(screen.queryByText("Please update mymeetingapp")).toBeNull();
    expect(screen.getByText("Your sobriety counter and help live here.")).toBeOnTheScreen();
  });

  it("still requires the upgrade offline, from the last config the phone saw", async () => {
    await writeCache("config", tooOld);
    await api.close();
    await renderApp("/online");
    expect(await screen.findByText("Please update mymeetingapp")).toBeOnTheScreen();
    api = await startApi();
  });

  it("fails open when the server can't be reached at all", async () => {
    await api.close();
    await renderApp("/");
    // A real request against the same (closed) server, wrapped in act() and awaited to settle, so the app's own
    // identical request — and the state update it triggers — has also settled before the assertions below run.
    await act(async () => {
      await expect(fetchConfig()).rejects.toThrow("The server couldn't be reached");
    });
    expect(screen.queryByText("Please update mymeetingapp")).toBeNull();
    expect(screen.getByText("Search by city, zip code or address, or use your location.")).toBeOnTheScreen();
    api = await startApi();
  });

  it("fails open when the server reports an error reading the config", async () => {
    api.reply("/api/v1/config", { error: { code: "invalid_request", message: "x" } }, 400);
    await renderApp("/");
    await waitFor(() => {
      expect(api.requests).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("Please update mymeetingapp")).toBeNull();
      expect(
        screen.getByText("Search by city, zip code or address, or use your location."),
      ).toBeOnTheScreen();
    });
  });

  it("lets a current version search", async () => {
    api.reply("/api/v1/config", CONFIG);
    await renderApp("/");
    await expectNotBlocked();
  });

  it("compares the installed version", async () => {
    setAppVersion("0.2.0");
    api.reply("/api/v1/config", tooOld);
    await renderApp("/");
    await expectNotBlocked();
  });

  it("fails open instead of crashing when the installed version can't be parsed (owner ruling M3)", async () => {
    setAppVersion("1.0");
    api.reply("/api/v1/config", tooOld);
    await renderApp("/");
    await expectNotBlocked();
  });
});

describe("Help now", () => {
  it("is in every tab's header", async () => {
    api.reply("/api/v1/config", CONFIG);
    for (const path of ["/", "/online", "/saved", "/me"]) {
      await renderApp(path);
      expect(await screen.findByRole("button", { name: "Help now: crisis lines" })).toBeOnTheScreen();
      await cleanup();
    }
  });

  it("opens the crisis lines and every one of their actions", async () => {
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
    await fireEvent.press(screen.getByRole("button", { name: "Open aa.org's meeting finder" }));
    expect(openURL).toHaveBeenCalledWith("https://www.aa.org/find-aa");
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

  // The root Stack's screenOptions gives every other root-stack screen a Help button too (SPEC: always reachable).
  // No such screen exists yet (T8's filters modal and T10's meeting route are next); until then this only proves the
  // Help screen itself doesn't grow a redundant one.
  it("doesn't duplicate the header button on the Help screen itself", async () => {
    api.reply("/api/v1/config", CONFIG);
    await renderApp("/help");
    await screen.findByText("Need help now?");
    expect(screen.queryByRole("button", { name: "Help now: crisis lines" })).toBeNull();
  });
});
