import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { appDatabase } from "@/db/database";
import { myTagsOn, recordSubmission } from "@/tagging/my-tags";

import { startApi, type TestApi } from "./api-server";
import { failStatements, resetAppData } from "./app-data";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { launchReadsLanded, renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DELETE_MINE = "/api/v1/tags/delete-mine";
const EMPTY = "You haven't tagged any meetings on this phone.";

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(async () => {
  await api.close();
});

async function openMe() {
  const app = await renderApp("/me");
  await launchReadsLanded();
  return app;
}

async function deleteAll() {
  await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
}

describe("Meetings I've tagged", () => {
  it("lists what this phone tagged, newest first, and opens a meeting", async () => {
    await recordSubmission(
      { id: ID, name: "Nooners" },
      ["welcoming", "coffee"],
      new Date("2026-10-05T17:00:00Z"),
    );
    await recordSubmission({ id: OTHER, name: "Early Birds" }, ["quiet"], new Date("2026-10-06T12:00:00Z"));
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting() });
    const app = await openMe();
    expect(screen.getByRole("header", { name: "Meetings I've tagged" })).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Nooners" })).toHaveProp(
      "accessibilityHint",
      "Opens the meeting",
    );
    expect(screen.getAllByRole("button", { name: /^(Nooners|Early Birds)$/ })).toEqual([
      screen.getByRole("button", { name: "Early Birds" }),
      screen.getByRole("button", { name: "Nooners" }),
    ]);
    expect(screen.getByText("Welcoming · Coffee · Oct 5, 2026")).toBeOnTheScreen();
    expect(screen.getByText("Quiet · Oct 6, 2026")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Nooners" }));
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${ID}`);
    });
    expect(await screen.findByText("Your tags: Welcoming · Coffee")).toBeOnTheScreen();
  });

  it("dates each meeting by its latest change", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-10-05T17:00:00Z"));
    const db = await appDatabase();
    await db.runAsync("update my_tags set updated_at = ? where meeting_id = ?", [
      new Date("2026-10-09T17:00:00Z").getTime(),
      ID,
    ]);
    await openMe();
    expect(await screen.findByText("Quiet · Oct 9, 2026")).toBeOnTheScreen();
  });

  it("says when this phone hasn't tagged anything", async () => {
    await openMe();
    expect(await screen.findByText(EMPTY)).toBeOnTheScreen();
  });

  it("is cleared by Delete all my tags once the server confirms, and kept when it can't be reached", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-10-05T17:00:00Z"));
    await openMe();
    await screen.findByRole("button", { name: "Nooners" });
    await deleteAll(); // no reply: unreachable
    await screen.findByText(/to finish deleting/);
    expect(screen.getByRole("button", { name: "Nooners" })).toBeOnTheScreen();
    expect(await myTagsOn(ID)).not.toBeNull();
    api.reply(DELETE_MINE, { deletedTags: 1 }, 200, "POST");
    await deleteAll();
    expect(await screen.findByText(EMPTY)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Nooners" })).toBeNull();
    expect(await myTagsOn(ID)).toBeNull();
  });

  it("says so when the phone can't clear its own list after the server deleted", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-10-05T17:00:00Z"));
    api.reply(DELETE_MINE, { deletedTags: 1 }, 200, "POST");
    await failStatements("runAsync", "delete from my_tags");
    await openMe();
    await screen.findByRole("button", { name: "Nooners" });
    await deleteAll();
    expect(
      await screen.findByText(
        /^Deleted your tags on 1 meeting,.* This phone couldn't clear its own list of tagged meetings\. Try again\.$/,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Nooners" })).toBeOnTheScreen();
  });

  it("says the phone failed, rather than that nothing was tagged, when the list can't be read", async () => {
    await failStatements("getAllAsync", "select meeting_id, name, tags");
    await openMe();
    expect(await screen.findByText("Something went wrong on this phone. Try again.")).toBeOnTheScreen();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete all my tags" })).toBeOnTheScreen();
  });
});
