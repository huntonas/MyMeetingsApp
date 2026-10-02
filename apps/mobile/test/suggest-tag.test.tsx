import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo, Keyboard } from "react-native";

import { startApi, type TestApi } from "./api-server";
import { resetAppData, storedCells } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { launchReadsLanded, renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PATH = `/api/v1/meetings/${ID}`;
// Nooners (fixtures.ts) meets Mondays 12:00–1:00 PM in Chicago: Monday 5 October 2026 at noon is 17:00 UTC.
const STARTED = "2026-10-05T17:00:00Z";
const SUGGEST = "/api/v1/suggestions";
const THANKS = "Thanks. We'll review it, and if it's added, it'll appear in the list for everyone.";
const NOT_A_TAG =
  "Use 2 to 40 letters or numbers, starting with a letter or number (spaces, apostrophes, hyphens and & are fine).";
const HELPER = "We review every suggestion. Don't include names or anything that could identify someone.";

let api: TestApi;
let announce: jest.SpyInstance;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  api.reply(PATH, { meeting: meeting() });
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(async () => {
  await api.close();
});

const suggestions = () => api.requests.filter((r) => r.path === SUGGEST);

// The tag section shows nothing until it has read the phone's own record, so this waits for its button (C12).
async function openPicker() {
  setNow(STARTED);
  await renderApp(`/meeting/${ID}`);
  await fireEvent.press(await screen.findByRole("button", { name: "Tag this meeting" }));
}

type Element = ReturnType<typeof screen.getByLabelText>;

// The scrolling page a field sits on.
function scrollViewAround(node: Element) {
  let at: Element | null = node;
  while (at !== null && at.type !== "RCTScrollView") at = at.parent;
  return at;
}

async function suggest(text: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Suggest a tag" }));
  await fireEvent.changeText(screen.getByLabelText("Your suggested tag"), text);
  await fireEvent.press(screen.getByRole("button", { name: "Send" }));
}

describe("Suggest a tag", () => {
  it("sends only the trimmed words and says thanks, never what the screening decided", async () => {
    api.reply(SUGGEST, { status: "received" }, 202, "POST");
    await openPicker();
    await suggest("  Candlelight  ");
    expect(await screen.findByText(THANKS)).toBeOnTheScreen();
    expect(screen.getByRole("alert")).toHaveTextContent(THANKS);
    expect(announce).toHaveBeenCalledWith(THANKS);
    const [sent] = suggestions();
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toBe('{"text":"Candlelight"}');
    expect(sent?.headers["x-device-id"]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sent?.headers["x-platform"]).toBe("ios");
    expect(sent?.headers["x-app-version"]).toBe("0.1.0");
    expect(screen.getByLabelText("Your suggested tag")).toHaveProp("value", "");
  });

  it("offers the suggestion as a quiet action, and moves VoiceOver to what it asks", async () => {
    const focus = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => undefined);
    await openPicker();
    const offer = screen.getByRole("button", { name: "Suggest a tag" });
    expect(offer).toHaveProp("accessibilityHint", "Suggest a word that isn't in the list");
    await fireEvent.press(offer);
    expect(screen.queryByRole("button", { name: "Suggest a tag" })).toBeNull();
    expect(focus).toHaveBeenLastCalledWith(
      expect.objectContaining({ props: expect.objectContaining({ children: HELPER }) as unknown }),
      "focus",
    );
    const field = screen.getByLabelText("Your suggested tag");
    expect(field).toHaveProp("maxLength", 60);
    // The rule is read with the field, before anything is typed.
    expect(field).toHaveProp("accessibilityHint", "2 to 40 letters or numbers");
  });

  // The keyboard covered both the field and Send (task 11's simulator check). The page scrolls what's focused, the
  // field, above the keyboard, so Send sits beside it rather than under it.
  it("keeps Send beside the field, and the field above the keyboard", async () => {
    await openPicker();
    await fireEvent.press(screen.getByRole("button", { name: "Suggest a tag" }));
    const field = screen.getByLabelText("Your suggested tag");
    const row = field.parent?.parent;
    if (!row) throw new Error("the field has no row around it");
    expect(row).toHaveStyle({ flexDirection: "row" });
    expect(within(row).getByRole("button", { name: "Send" })).toBeOnTheScreen();
    expect(scrollViewAround(field)).toHaveProp("automaticallyAdjustKeyboardInsets", true);
  });

  // Otherwise the first tap on Send, with the keyboard up, would only put the keyboard away.
  it("sends on the first tap, and puts the keyboard away so the answer shows", async () => {
    api.reply(SUGGEST, { status: "received" }, 202, "POST");
    const dismiss = jest.spyOn(Keyboard, "dismiss");
    await openPicker();
    await suggest("Candlelight");
    expect(scrollViewAround(screen.getByLabelText("Your suggested tag"))).toHaveProp(
      "keyboardShouldPersistTaps",
      "handled",
    );
    expect(dismiss).toHaveBeenCalled();
    expect(await screen.findByText(THANKS)).toBeOnTheScreen();
  });

  it.each(["ab", "a".repeat(40), " " + "a".repeat(40) + " "])("sends %p, trimmed", async (text) => {
    api.reply(SUGGEST, { status: "received" }, 202, "POST");
    await openPicker();
    await suggest(text);
    expect(await screen.findByText(THANKS)).toBeOnTheScreen();
    expect(suggestions().map((r) => r.body)).toEqual([JSON.stringify({ text: text.trim() })]);
  });

  it.each(["x", "a".repeat(41), "<b>bold</b>", "https://x.y", "   ", "-dash"])(
    "checks %p on the phone and sends nothing",
    async (text) => {
      await openPicker();
      await suggest(text);
      expect(screen.getByRole("alert")).toHaveTextContent(NOT_A_TAG);
      expect(announce).toHaveBeenCalledWith(NOT_A_TAG);
      expect(suggestions()).toEqual([]);
    },
  );

  it("shows the server's words at the daily limit, and keeps the words to try again", async () => {
    api.reply(
      SUGGEST,
      {
        error: { code: "rate_limited", message: "You've reached today's limit. Please try again tomorrow." },
      },
      429,
      "POST",
    );
    await openPicker();
    await suggest("Candlelight");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've reached today's limit. Please try again tomorrow.",
    );
    expect(screen.getByLabelText("Your suggested tag")).toHaveProp("value", "Candlelight");
  });

  it("says it can't tell whether the suggestion arrived when the server can't be reached", async () => {
    await openPicker();
    await suggest("Candlelight");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach mymeetingapp, so we can't tell whether your suggestion arrived. Try again.",
    );
  });

  it("sends once while the first is out", async () => {
    const answer = api.answerLater(SUGGEST);
    await openPicker();
    await suggest("Candlelight");
    expect(await screen.findByLabelText("Sending your suggestion")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    // Return on the keyboard doesn't send it again either.
    expect(screen.getByLabelText("Your suggested tag")).toHaveProp("editable", false);
    await fireEvent(screen.getByLabelText("Your suggested tag"), "submitEditing");
    answer({ status: "received" });
    expect(await screen.findByText(THANKS)).toBeOnTheScreen();
    expect(suggestions()).toHaveLength(1);
  });

  it("keeps none of the words on the phone", async () => {
    api.reply(SUGGEST, { status: "received" }, 202, "POST");
    await openPicker();
    await suggest("Zanzibarish");
    expect(await screen.findByText(THANKS)).toBeOnTheScreen();
    for (const cell of await storedCells()) expect(cell).not.toMatch(/Zanzibarish/);
  });

  it("isn't offered while suggestions are switched off", async () => {
    api.reply("/api/v1/config", { ...CONFIG, features: { tagging: true, suggestions: false } });
    await openPicker();
    // The picker is drawn and the config read has landed, so an absence here is the switch's doing.
    expect(screen.getByRole("header", { name: "Tag this meeting" })).toBeOnTheScreen();
    await launchReadsLanded();
    // Drawn with every switch on until the config is read, so it goes once the read is shown.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Suggest a tag" })).toBeNull();
    });
  });
});
