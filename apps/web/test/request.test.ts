import { z } from "zod";
import { describe, expect, it } from "vitest";

import { parseInput, readJsonBody } from "@/lib/api/request";
import { ApiError, withErrors } from "@/lib/api/respond";

const Body = z.object({ n: z.number().int() });
// eslint-disable-next-line no-restricted-syntax -- test handler echoes the parsed body
const echo = withErrors(async (req: Request) => Response.json(await readJsonBody(req, Body)));

function post(body: string) {
  return echo(new Request("http://test/api", { method: "POST", body }));
}

describe("parseInput", () => {
  it("returns the parsed value when it matches the schema", () => {
    expect(parseInput(Body, { n: 3 })).toEqual({ n: 3 });
  });

  it("throws an ApiError with code invalid_request when the value doesn't match", () => {
    expect(() => parseInput(Body, { n: "3" })).toThrow(ApiError);
  });
});

describe("readJsonBody", () => {
  it("returns the parsed body", async () => {
    expect(await (await post('{"n":3}')).json()).toEqual({ n: 3 });
  });

  it.each(["not json", "", '{"n":"3"}', '{"n":1.5}', "[]"])("rejects %j as invalid_request", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Something in that request wasn't right. Please update the app and try again.",
      },
    });
  });
});
