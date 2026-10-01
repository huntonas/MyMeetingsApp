import { DeleteMineResponse, ERROR_MESSAGES } from "@mymeetingapp/shared";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { deleteMine } from "@/api/writes";
import { useCachedRead } from "@/cache/use-cached-read";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CONFIG, VOCABULARY } from "./fixtures";
import { setKeychainTrouble } from "./native/expo-secure-store";
import { launchReadsLanded, renderApp } from "./render-app";

const DELETE_MINE = "/api/v1/tags/delete-mine";

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

// The read path: the same failing request, read through useCachedRead as a screen's data would be.
function ReadOfDeleteMine() {
  const { state } = useCachedRead({
    kind: "vocabulary",
    key: "failure-message-test",
    schema: DeleteMineResponse,
    fetch: deleteMine,
  });
  return <Text>{state.status === "failed" ? state.message : state.status}</Text>;
}

// One table of failures, each read through both paths and held to the same words. Only "the server can't be reached"
// differs, on purpose: each caller says what it couldn't finish.
const FAILURES: [string, () => void, string][] = [
  [
    "the server refuses",
    () => {
      api.reply(
        DELETE_MINE,
        { error: { code: "device_blocked", message: ERROR_MESSAGES.device_blocked } },
        403,
        "POST",
      );
    },
    "Tagging isn't available from this device.",
  ],
  [
    "the phone fails",
    () => {
      setKeychainTrouble("fails");
    },
    "Something went wrong on this phone. Try again.",
  ],
];

describe.each(FAILURES)("when %s, the same words show", (_case, fail, message) => {
  it("on the read path", async () => {
    fail();
    await render(<ReadOfDeleteMine />);
    expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  it("on the write path", async () => {
    fail();
    await renderApp("/me");
    await launchReadsLanded();
    await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
    await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
    expect(await screen.findByText(message)).toBeOnTheScreen();
  });
});
