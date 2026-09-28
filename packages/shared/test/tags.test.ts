import { describe, expect, it } from "vitest";

import { TagSubmissionRequest } from "../src/index";

const meetingId = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("TagSubmissionRequest", () => {
  it("accepts a meeting, its tags and the attendance check", () => {
    const body = { meetingId, tags: ["laid-back", "coffee"], nearMeeting: true };
    expect(TagSubmissionRequest.parse(body)).toEqual(body);
  });

  it.each([[[]], [["coffee", "coffee"]], [Array.from({ length: 51 }, (_, i) => `tag-${String(i)}`)]])(
    "rejects the tag list %j",
    (list) => {
      expect(TagSubmissionRequest.safeParse({ meetingId, tags: list }).success).toBe(false);
    },
  );

  it("leaves seven tags to the server, which answers too_many_tags", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect(TagSubmissionRequest.safeParse({ meetingId, tags: seven }).success).toBe(true);
  });
});
