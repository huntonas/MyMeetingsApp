import { cleanup, fireEvent, screen } from "@testing-library/react-native";
import { Linking, Platform } from "react-native";
import { z } from "zod";

import { readSobrietyDate, saveSobrietyDate } from "@/sobriety/sobriety-date";

import { startApi, type TestApi } from "./api-server";
import { failStatements, resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, VOCABULARY } from "./fixtures";
import { setAppVersion } from "./native/expo-application";
import { launchReadsLanded, renderApp } from "./render-app";

const INTRO = "Keep count of your sober time. The date is kept on this phone and never sent to our server.";
const PHONE_FAILURE = "Something went wrong on this phone. Try again.";

let api: TestApi;
let openURL: jest.SpyInstance;

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  // Noon on the phone, which is in America/Chicago (package.json).
  setNow("2026-10-05T17:00:00Z");
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(async () => {
  await api.close();
});

// Opens the Me tab once launch's reads have landed, so nothing from launch lands in the middle of a test.
async function openMe() {
  await renderApp("/me");
  await launchReadsLanded();
}

// The picker hands back the chosen day at the time of day it was opened, as the real one does.
async function pickInPicker(year: number, monthIndex: number, day: number) {
  const chosen = new Date(year, monthIndex, day, 12);
  await fireEvent(
    screen.getByTestId("date-picker"),
    "valueChange",
    { nativeEvent: { timestamp: chosen.getTime(), utcOffset: -300 } },
    chosen,
  );
}

// On iPhone the calendar sits in the screen: tapping a day only chooses it, and "Save this date" keeps it.
async function setDate(button: string, year: number, monthIndex: number, day: number) {
  await fireEvent.press(await screen.findByRole("button", { name: button }));
  await pickInPicker(year, monthIndex, day);
  await fireEvent.press(screen.getByRole("button", { name: "Save this date" }));
}

describe("the sobriety counter", () => {
  it("counts from a date set on the phone, with today's milestone and the next", async () => {
    await openMe();
    expect(await screen.findByText(INTRO)).toBeOnTheScreen();
    await setDate("Set my sobriety date", 2025, 9, 5);
    expect(await screen.findByText("365 days")).toBeOnTheScreen();
    expect(screen.getByText("1 year")).toBeOnTheScreen();
    expect(screen.getByText("Since Oct 5, 2025")).toBeOnTheScreen();
    expect(screen.getByText("Today marks 1 year.")).toBeOnTheScreen();
    expect(screen.getByText("Next: 2 years on Oct 5, 2027")).toBeOnTheScreen();
    expect(screen.queryByTestId("date-picker")).toBeNull();
    expect(await readSobrietyDate()).toEqual({ year: 2025, month: 10, day: 5 });
  });

  it("shows the date kept on the phone when the app opens again", async () => {
    await saveSobrietyDate({ year: 2011, month: 4, day: 17 });
    await openMe();
    expect(await screen.findByText("5,650 days")).toBeOnTheScreen();
    expect(screen.getByText("15 years, 5 months, 18 days")).toBeOnTheScreen();
    expect(screen.getByText("Next: 16 years on Apr 17, 2027")).toBeOnTheScreen();
    expect(screen.queryByText(/^Today marks/)).toBeNull();
  });

  it("uses neutral words to set a new date, and can remove it", async () => {
    await saveSobrietyDate({ year: 2025, month: 10, day: 5 });
    await openMe();
    await setDate("Set a new date", 2026, 9, 1);
    expect(await screen.findByText("4 days")).toBeOnTheScreen();
    // Under a month, the breakdown would only say the same thing again.
    expect(screen.getAllByText(/4 days/)).toHaveLength(1);
    expect(screen.getByText("Next: 30 days on Oct 31, 2026")).toBeOnTheScreen();
    expect(screen.queryByText(/streak|reset|relapse|start over|broke|lost/i)).toBeNull();
    expect(await readSobrietyDate()).toEqual({ year: 2026, month: 10, day: 1 });

    await fireEvent.press(screen.getByRole("button", { name: "Remove the date" }));
    expect(await screen.findByRole("button", { name: "Set my sobriety date" })).toBeOnTheScreen();
    expect(screen.getByText(INTRO)).toBeOnTheScreen();
    expect(screen.queryByText("4 days")).toBeNull();
    expect(await readSobrietyDate()).toBeNull();
  });

  it("shows the breakdown once there's a whole month in it", async () => {
    await saveSobrietyDate({ year: 2026, month: 9, day: 5 });
    await openMe();
    expect(await screen.findByText("30 days")).toBeOnTheScreen();
    expect(screen.getByText("1 month")).toBeOnTheScreen();
    expect(screen.getByText("Today marks 30 days.")).toBeOnTheScreen();
  });

  it("starts at 0 days on the day it's set, with 24 hours next", async () => {
    await openMe();
    await setDate("Set my sobriety date", 2026, 9, 5);
    expect(await screen.findByText("0 days")).toBeOnTheScreen();
    expect(screen.getByText("Next: 24 hours on Oct 6, 2026")).toBeOnTheScreen();
  });

  it("keeps the date it had when the choice is cancelled", async () => {
    await saveSobrietyDate({ year: 2025, month: 10, day: 5 });
    await openMe();
    await fireEvent.press(await screen.findByRole("button", { name: "Set a new date" }));
    await pickInPicker(2026, 9, 1);
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("date-picker")).toBeNull();
    expect(screen.getByText("365 days")).toBeOnTheScreen();
    expect(await readSobrietyDate()).toEqual({ year: 2025, month: 10, day: 5 });
  });

  it("offers no day after today, and refuses one if it's chosen anyway", async () => {
    await openMe();
    await fireEvent.press(await screen.findByRole("button", { name: "Set my sobriety date" }));
    const maximum = z.date().parse(screen.getByTestId("date-picker").props.maximumDate);
    expect(maximum.getTime()).toBe(new Date("2026-10-05T17:00:00Z").getTime());
    await pickInPicker(2026, 9, 6);
    await fireEvent.press(screen.getByRole("button", { name: "Save this date" }));
    expect(await screen.findByText("Choose today or an earlier date.")).toBeOnTheScreen();
    expect(screen.getByTestId("date-picker")).toBeOnTheScreen();
    expect(await readSobrietyDate()).toBeNull();
  });

  it("counts on the phone's own calendar, late in the evening too", async () => {
    await saveSobrietyDate({ year: 2025, month: 10, day: 5 });
    // 11:30 PM on Oct 5 in Chicago, already Oct 6 in UTC.
    setNow("2026-10-06T04:30:00Z");
    await openMe();
    expect(await screen.findByText("365 days")).toBeOnTheScreen();
  });

  it("moves on to the next day when the tab comes back into view", async () => {
    await saveSobrietyDate({ year: 2025, month: 10, day: 5 });
    await openMe();
    expect(await screen.findByText("365 days")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Saved"));
    setNow("2026-10-06T17:00:00Z");
    await fireEvent.press(screen.getByLabelText("Me"));
    expect(await screen.findByText("366 days")).toBeOnTheScreen();
    expect(screen.queryByText("Today marks 1 year.")).toBeNull();
  });

  it("keeps a date that's after today when the phone's clock has gone back, and says so", async () => {
    await saveSobrietyDate({ year: 2026, month: 10, day: 6 });
    await openMe();
    expect(
      await screen.findByText(
        "Your sobriety date is Oct 6, 2026, which is after today's date on this phone.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Set a new date" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Remove the date" })).toBeOnTheScreen();
    expect(await readSobrietyDate()).toEqual({ year: 2026, month: 10, day: 6 });
  });

  it("never sends the date anywhere", async () => {
    await openMe();
    await setDate("Set my sobriety date", 2025, 9, 5);
    await screen.findByText("365 days");
    await cleanup();
    await openMe();
    await screen.findByText("365 days");
    expect(api.requests.length).toBeGreaterThan(0);
    for (const request of api.requests) {
      expect(`${request.path} ${request.body} ${JSON.stringify(request.headers)}`).not.toMatch(/2025/);
    }
  });
});

describe("the sobriety counter on Android", () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "android");
  });

  it("keeps the day chosen in the system dialog, with no extra button", async () => {
    await openMe();
    await fireEvent.press(await screen.findByRole("button", { name: "Set my sobriety date" }));
    expect(screen.queryByRole("button", { name: "Save this date" })).toBeNull();
    await pickInPicker(2025, 9, 5);
    expect(await screen.findByText("365 days")).toBeOnTheScreen();
    expect(screen.queryByTestId("date-picker")).toBeNull();
    expect(await readSobrietyDate()).toEqual({ year: 2025, month: 10, day: 5 });
  });

  it("keeps nothing when the dialog is cancelled", async () => {
    await openMe();
    await fireEvent.press(await screen.findByRole("button", { name: "Set my sobriety date" }));
    await fireEvent(screen.getByTestId("date-picker"), "dismiss");
    expect(screen.queryByTestId("date-picker")).toBeNull();
    expect(screen.getByRole("button", { name: "Set my sobriety date" })).toBeOnTheScreen();
    expect(await readSobrietyDate()).toBeNull();
  });

  it("refuses a day after today", async () => {
    await openMe();
    await fireEvent.press(await screen.findByRole("button", { name: "Set my sobriety date" }));
    await pickInPicker(2026, 9, 6);
    expect(await screen.findByText("Choose today or an earlier date.")).toBeOnTheScreen();
    expect(await readSobrietyDate()).toBeNull();
  });
});

describe("the sobriety counter when the phone can't read or write it", () => {
  it("says so, rather than offering to set a date over one it couldn't read", async () => {
    await saveSobrietyDate({ year: 2025, month: 10, day: 5 });
    await failStatements("getAllAsync", "select value from settings");
    await openMe();
    expect(await screen.findByText(PHONE_FAILURE)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /date/ })).toBeNull();
    expect(screen.getByText("988 Suicide & Crisis Lifeline")).toBeOnTheScreen();
  });

  it("says so when the date can't be saved, and keeps the one it had", async () => {
    await saveSobrietyDate({ year: 2025, month: 10, day: 5 });
    await openMe();
    const save = await failStatements("runAsync", "insert or replace into settings");
    await setDate("Set a new date", 2026, 9, 1);
    expect(await screen.findByText(PHONE_FAILURE)).toBeOnTheScreen();
    expect(save).toHaveBeenCalled();
    expect(screen.getByText("365 days")).toBeOnTheScreen();
    expect(await readSobrietyDate()).toEqual({ year: 2025, month: 10, day: 5 });
  });

  it("says so when the date can't be removed, and keeps counting", async () => {
    await saveSobrietyDate({ year: 2025, month: 10, day: 5 });
    await openMe();
    await failStatements("runAsync", "delete from settings");
    await fireEvent.press(await screen.findByRole("button", { name: "Remove the date" }));
    expect(await screen.findByText(PHONE_FAILURE)).toBeOnTheScreen();
    expect(screen.getByText("365 days")).toBeOnTheScreen();
    expect(await readSobrietyDate()).toEqual({ year: 2025, month: 10, day: 5 });
  });
});

describe("the rest of the Me tab", () => {
  it("links to the website's privacy policy, support page and terms", async () => {
    await openMe();
    await fireEvent.press(screen.getByRole("button", { name: "Privacy policy" }));
    expect(openURL).toHaveBeenLastCalledWith("http://127.0.0.1:3197/privacy");
    await fireEvent.press(screen.getByRole("button", { name: "Support" }));
    expect(openURL).toHaveBeenLastCalledWith("http://127.0.0.1:3197/support");
    await fireEvent.press(screen.getByRole("button", { name: "Terms of use" }));
    expect(openURL).toHaveBeenLastCalledWith("http://127.0.0.1:3197/terms");
  });

  it("shows the installed version", async () => {
    setAppVersion("1.4.2");
    await openMe();
    expect(screen.getByText("Version 1.4.2")).toBeOnTheScreen();
  });

  it("still works when the build's own version can't be read", async () => {
    setAppVersion(null);
    await openMe();
    expect(await screen.findByText(INTRO)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Privacy policy" })).toBeOnTheScreen();
    expect(screen.queryByText(/^Version/)).toBeNull();
  });

  it("shows the help lines, and never the app's ID", async () => {
    await openMe();
    expect(screen.getByText("988 Suicide & Crisis Lifeline")).toBeOnTheScreen();
    expect(screen.getByText("SAMHSA National Helpline")).toBeOnTheScreen();
    expect(screen.queryByText(/app ID|device ID/i)).toBeNull();
  });
});
