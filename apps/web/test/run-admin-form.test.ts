import { format } from "node:util";

import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAdminForm } from "@/app/metrics/run-admin-form";
import { db, pool } from "@/db/client";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { ApproveSuggestionForm, approveSuggestion, RejectSuggestionForm } from "@/server/admin/suggestions";

import { formData, pendingSuggestion } from "./admin-fixtures";
import { resetDb } from "./db";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

describe("runAdminForm", () => {
  it("answers invalid_form for a form the schema refuses, without running the change", async () => {
    const run = vi.fn(() => Promise.resolve("rejected" as const));
    expect(await runAdminForm(RejectSuggestionForm, run, formData({ suggestionId: "x" }))).toBe(
      "invalid_form",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("answers failed when the change throws, and never logs the form's text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const id = await pendingSuggestion("Secret words xyz");
    // Any new tag now breaks a constraint, as a database fault would.
    await db.execute(sql`alter table tags add constraint admin_action_test_check check (false) not valid`);
    try {
      const notice = await runAdminForm(
        ApproveSuggestionForm,
        approveSuggestion,
        formData({ suggestionId: String(id), label: "Secret words xyz", category: "feel" }),
      );
      expect(notice).toBe("failed");
    } finally {
      await db.execute(sql`alter table tags drop constraint admin_action_test_check`);
    }
    const logged = log.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain("admin_action_test_check");
    expect(logged).not.toContain("Secret words");
  });

  it("lets a Next.js redirect through rather than reporting a failure", async () => {
    const redirecting = () => redirect("/metrics");
    await expect(
      runAdminForm(RejectSuggestionForm, redirecting, formData({ suggestionId: "1" })),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});
