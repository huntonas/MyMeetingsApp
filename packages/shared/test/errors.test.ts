import { describe, expect, it } from "vitest";

import { ApiErrorBody } from "../src/index";

describe("ApiErrorBody", () => {
  it("accepts an envelope with a known code", () => {
    const body = { error: { code: "server_error", message: "Something went wrong." } };
    expect(ApiErrorBody.parse(body)).toEqual(body);
  });

  it("rejects an unknown code", () => {
    expect(ApiErrorBody.safeParse({ error: { code: "nope", message: "x" } }).success).toBe(false);
  });

  it("rejects a body without the error wrapper", () => {
    expect(ApiErrorBody.safeParse({ code: "server_error", message: "x" }).success).toBe(false);
  });
});
