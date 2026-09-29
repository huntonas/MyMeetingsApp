import { describe, expect, it } from "vitest";

import { Notice } from "@/app/metrics/notice";

import { renderText } from "./render";

describe("Notice", () => {
  it("shows the message for the outcome an admin action returned", () => {
    expect(renderText(<Notice params={{ notice: "rejected" }} />)).toBe("Rejected.");
  });

  it.each([{}, { notice: "toString" }, { notice: "<script>" }, { notice: ["rejected", "approved"] }])(
    "shows nothing for %j",
    (params) => {
      expect(renderText(<Notice params={params} />)).toBe("");
    },
  );
});
