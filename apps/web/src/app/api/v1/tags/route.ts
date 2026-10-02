import { TagSubmissionRequest, TagWriteResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { assertFeatureEnabled } from "@/server/app-config";
import { readWriteRequest } from "@/server/devices/write-request";
import { submitTags } from "@/server/tags/submit";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request) => {
  assertFeatureEnabled("tagging");
  const { device, body } = await readWriteRequest(req, TagSubmissionRequest);
  return jsonResponse(TagWriteResponse, await submitTags(device, body), "none", 201);
});
