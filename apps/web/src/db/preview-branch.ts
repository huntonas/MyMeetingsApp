import { z } from "zod";

import { readEnv } from "@/env";

const DEFAULT_NEON_API_URL = "https://console.neon.tech/api/v2";
const SEED_BRANCH_NAME = "seed";
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 120_000;

const BranchBody = z.object({
  branch: z.object({
    id: z.string(),
    name: z.string(),
    parent_id: z.string().optional(),
    default: z.boolean(),
  }),
});
const Operation = z.object({ id: z.string(), status: z.string() });
type Operation = z.infer<typeof Operation>;
const RestoreBody = z.object({ operations: z.array(Operation) });
const OperationBody = z.object({ operation: Operation });
const DONE = new Set(["finished", "skipped"]);
const FAILED = new Set(["failed", "error", "cancelling", "cancelled"]);

type NeonSetting = "NEON_API_KEY" | "NEON_PROJECT_ID" | "NEON_PREVIEW_BRANCH_ID";

function setting(name: NeonSetting): string {
  const value = readEnv(name);
  if (value === undefined) throw new Error(`${name} must be set for preview builds`);
  return value;
}

// Every preview deployment shares one Neon branch, "preview", whose parent "seed" holds reference data only
// (vocabulary, feeds, meetings). Each preview build restores it to seed's latest state before migrating, so
// nothing from production and no earlier preview's device data survives into a new preview. Production and
// local builds leave the database alone. Neon's "reset from parent" is the restore endpoint with the parent
// as source; the parent must be seed, so a mistyped branch id can never overwrite main.
// Vercel reports a custom environment such as staging as VERCEL_ENV=preview; only VERCEL_TARGET_ENV tells them apart.
export async function resetPreviewBranch(): Promise<"reset" | "skipped"> {
  if (readEnv("VERCEL_TARGET_ENV") !== "preview") return "skipped";
  const apiKey = setting("NEON_API_KEY");
  const base = `${readEnv("NEON_API_URL") ?? DEFAULT_NEON_API_URL}/projects/${setting("NEON_PROJECT_ID")}`;
  const branchId = setting("NEON_PREVIEW_BRANCH_ID");

  async function call(method: "GET" | "POST", path: string, body?: object): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Neon API ${method} ${path} returned ${String(response.status)}`);
    return response.json();
  }

  async function waitFor(started: Operation, deadline: number): Promise<void> {
    let operation = started;
    while (!DONE.has(operation.status)) {
      if (FAILED.has(operation.status)) throw new Error(`Neon operation ${operation.id} ${operation.status}`);
      if (Date.now() > deadline) throw new Error(`Neon operation ${operation.id} did not finish in time`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      operation = OperationBody.parse(await call("GET", `/operations/${operation.id}`)).operation;
    }
  }

  const { branch } = BranchBody.parse(await call("GET", `/branches/${branchId}`));
  const parent =
    branch.default || branch.parent_id === undefined
      ? undefined
      : BranchBody.parse(await call("GET", `/branches/${branch.parent_id}`)).branch;
  if (parent?.name !== SEED_BRANCH_NAME) {
    throw new Error(
      `NEON_PREVIEW_BRANCH_ID must name a branch made from "${SEED_BRANCH_NAME}"; refusing to restore "${branch.name}"`,
    );
  }
  const { operations } = RestoreBody.parse(
    await call("POST", `/branches/${branchId}/restore`, { source_branch_id: parent.id }),
  );
  const deadline = Date.now() + MAX_WAIT_MS;
  for (const operation of operations) await waitFor(operation, deadline);
  return "reset";
}
