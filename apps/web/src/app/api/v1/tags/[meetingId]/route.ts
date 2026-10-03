import { TagEditRequest, TagWriteResponse } from "@mymeetingapp/shared";
import { z } from "zod";

import { parseInput } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { assertFeatureEnabled } from "@/server/app-config";
import { readDeletionRequest, readWriteRequest } from "@/server/devices/write-request";
import { deleteTags, editTags } from "@/server/tags/edit";

export const dynamic = "force-dynamic";

const Params = z.object({ meetingId: z.uuid() });
interface Context {
  params: Promise<{ meetingId: string }>;
}

export const PUT = withErrors(async (req: Request, context: Context) => {
  assertFeatureEnabled("tagging");
  const { meetingId } = parseInput(Params, await context.params);
  const { device, body } = await readWriteRequest(req, TagEditRequest);
  return jsonResponse(TagWriteResponse, await editTags(device, meetingId, body), "none");
});

// No feature switch and no minimum app version: deleting your tags always works.
export const DELETE = withErrors(async (req: Request, context: Context) => {
  const device = await readDeletionRequest(req);
  const { meetingId } = parseInput(Params, await context.params);
  return jsonResponse(TagWriteResponse, await deleteTags(device, meetingId), "none");
});
