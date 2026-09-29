import { assertCronRequest } from "@/lib/api/cron-auth";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { MaintenanceSummary, runMaintenance } from "@/server/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withErrors(async (req: Request) => {
  assertCronRequest(req);
  return jsonResponse(MaintenanceSummary, await runMaintenance(), "none");
});
