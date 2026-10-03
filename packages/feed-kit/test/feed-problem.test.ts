import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { feedProblem, feedProblemMessage } from "../src/index";

// Response shapes recorded on 2026-10-02 (the challenge pages trimmed, their IDs zeroed); never a live site.
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const CLOUDFLARE = fixture("cloudflare-challenge.html");
const INCAPSULA = fixture("incapsula-challenge.html");
const TSML_RESTRICTED = fixture("tsml-restricted.json");
const PLAIN_PAGE = fixture("plain-page.html");

const described = (status: number, contentType: string | null, body: string) => {
  const problem = feedProblem({ status, contentType, body });
  return problem === null ? null : feedProblemMessage(problem);
};

describe("feedProblem", () => {
  it("names Cloudflare's challenge page, served as a 403", () => {
    expect(feedProblem({ status: 403, contentType: "text/html; charset=UTF-8", body: CLOUDFLARE })).toEqual({
      kind: "bot_check",
      by: "Cloudflare",
    });
    expect(described(403, "text/html; charset=UTF-8", CLOUDFLARE)).toBe(
      "blocked by a bot check (Cloudflare)",
    );
  });

  it("names Incapsula's challenge page, even when it comes with a 200", () => {
    expect(described(200, "text/html", INCAPSULA)).toBe("blocked by a bot check (Incapsula)");
  });

  it("calls a 403 restricted only when the site says so in JSON, as TSML does", () => {
    expect(TSML_RESTRICTED.length).toBe(93);
    expect(described(403, "application/json; charset=UTF-8", TSML_RESTRICTED)).toBe(
      "restricted by the site (HTTP 403)",
    );
    expect(described(401, "application/json", '{"error":"HTTP/1.1 401 Unauthorized"}')).toBe(
      "restricted by the site (HTTP 401)",
    );
  });

  it("calls a 403 that's an ordinary page just an HTTP 403", () => {
    expect(described(403, "text/html", PLAIN_PAGE)).toBe("HTTP 403");
  });

  it("says what came instead of JSON on a 200", () => {
    expect(described(200, "text/html; charset=UTF-8", PLAIN_PAGE)).toBe("not valid JSON (text/html)");
    expect(described(200, null, "<html>")).toBe("not valid JSON (no content type)");
  });

  it("reports any other refusal by its status", () => {
    expect(described(500, "text/html", PLAIN_PAGE)).toBe("HTTP 500");
  });

  it("finds nothing wrong with a JSON feed, even one whose text mentions a challenge", () => {
    expect(
      described(200, "application/json", '[{"slug":"a","notes":"Just a moment... we start late"}]'),
    ).toBeNull();
  });
});
