import { DeleteMineResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { readDeletionRequest } from "@/server/devices/write-request";
import { deleteMine } from "@/server/tags/delete-mine";

export const dynamic = "force-dynamic";

// No feature switch: deleting your data always works.
export const POST = withErrors(async (req: Request) =>
  jsonResponse(DeleteMineResponse, await deleteMine(readDeletionRequest(req)), "none"),
);
