import { fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CONFIG, VOCABULARY } from "./fixtures";
import { setAppVersion } from "./native/expo-application";
import { setKeychainTrouble } from "./native/expo-secure-store";
import { launchReadsLanded, renderApp } from "./render-app";

const DELETE_MINE = "/api/v1/tags/delete-mine";
const QUESTION = "Delete every tag this phone has added, on every meeting? This can't be undone.";

let api: TestApi;
let announce: jest.SpyInstance;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(async () => {
  await api.close();
});

const deletions = () => api.requests.filter((r) => r.path === DELETE_MINE);

async function deleteAll() {
  await renderApp("/me");
  await launchReadsLanded();
  await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
  expect(screen.getByText(QUESTION)).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith(QUESTION);
  await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
}

describe("Delete all my tags", () => {
  it("asks first, and keeping them sends nothing", async () => {
    await renderApp("/me");
    await launchReadsLanded();
    await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
    await fireEvent.press(screen.getByRole("button", { name: "Keep them" }));
    expect(screen.getByRole("button", { name: "Delete all my tags" })).toBeOnTheScreen();
    expect(deletions()).toEqual([]);
  });

  it.each([
    [
      3,
      "Deleted your tags on 3 meetings, and everything else our server kept for this phone. Counts in the app catch up within 75 minutes.",
    ],
    [
      1,
      "Deleted your tags on 1 meeting, and everything else our server kept for this phone. Counts in the app catch up within 75 minutes.",
    ],
    [0, "Our server held no tags from this phone, and anything else it kept for this phone is deleted."],
  ])("says what the server deleted (%i tags)", async (deletedTags, message) => {
    api.reply(DELETE_MINE, { deletedTags }, 200, "POST");
    await deleteAll();
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(message);
    expect(deletions()).toHaveLength(1);
    expect(deletions()[0]?.headers["x-device-id"]).toBeDefined();
  });

  it("can't be sent twice while the server is still deleting", async () => {
    const answer = api.answerLater(DELETE_MINE);
    await deleteAll();
    expect(await screen.findByLabelText("Deleting your tags")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Delete all my tags" })).toBeNull();
    answer({ deletedTags: 1 });
    expect(await screen.findByText(/^Deleted your tags on 1 meeting,/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Delete all my tags" })).toBeOnTheScreen();
    expect(deletions()).toHaveLength(1);
  });

  it("keeps working below the minimum version and with tagging switched off", async () => {
    api.reply("/api/v1/config", {
      ...CONFIG,
      minSupportedVersion: { ios: "9.0.0", android: "9.0.0" },
      features: { tagging: false, suggestions: false },
    });
    setAppVersion("0.1.0");
    api.reply(DELETE_MINE, { deletedTags: 2 }, 200, "POST");
    await deleteAll();
    expect(await screen.findByText(/^Deleted your tags on 2 meetings/)).toBeOnTheScreen();
  });

  it("says the deletion didn't finish when the server can't be reached", async () => {
    // No reply set: the test server answers 599 with no envelope, which the app treats as unreachable.
    await deleteAll();
    expect(
      await screen.findByText(
        "We couldn't reach My Meeting App to finish deleting. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
  });

  it("shows the server's own words when it refuses", async () => {
    api.reply(
      DELETE_MINE,
      {
        error: {
          code: "server_error",
          message: "Something went wrong on our end. Please try again in a few minutes.",
        },
      },
      500,
      "POST",
    );
    await deleteAll();
    expect(
      await screen.findByText("Something went wrong on our end. Please try again in a few minutes."),
    ).toBeOnTheScreen();
  });

  it("says the phone failed, and sends nothing, when the phone's ID can't be read", async () => {
    setKeychainTrouble("fails");
    await deleteAll();
    expect(await screen.findByText("Something went wrong on this phone. Try again.")).toBeOnTheScreen();
    expect(deletions()).toEqual([]);
  });
});
