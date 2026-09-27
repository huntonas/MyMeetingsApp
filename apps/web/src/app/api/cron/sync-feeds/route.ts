import { assertCronRequest } from "@/lib/api/cron-auth";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { runSync, SyncSummary } from "@/server/sync/run-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Stop starting new feeds after ~240 s so the run always finishes inside maxDuration (spec §3).
const SYNC_BUDGET_MS = 240_000;

export const GET = withErrors(async (req: Request) => {
  assertCronRequest(req);
  return jsonResponse(SyncSummary, await runSync(SYNC_BUDGET_MS), "none");
});
