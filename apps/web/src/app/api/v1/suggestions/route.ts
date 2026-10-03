import { SuggestionRequest, SuggestionResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { assertFeatureEnabled } from "@/server/app-config";
import { readWriteRequest } from "@/server/devices/write-request";
import { submitSuggestion } from "@/server/suggestions/submit";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request) => {
  assertFeatureEnabled("suggestions");
  const { device, body } = await readWriteRequest(req, SuggestionRequest);
  await submitSuggestion(device, body.text);
  return jsonResponse(SuggestionResponse, { status: "received" }, "none", 202);
});
