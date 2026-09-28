import { TagSubmissionRequest, TagWriteResponse } from "@mymeetingapp/shared";

import { readJsonBody } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { assertFeatureEnabled } from "@/server/app-config";
import { readWriteRequest } from "@/server/devices/write-request";
import { submitTags } from "@/server/tags/submit";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request) => {
  assertFeatureEnabled("tagging");
  const device = readWriteRequest(req);
  const request = await readJsonBody(req, TagSubmissionRequest);
  return jsonResponse(TagWriteResponse, await submitTags(device, request), "none", 201);
});
