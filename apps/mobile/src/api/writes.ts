import { DeleteMineResponse, TagSubmissionRequest, TagWriteResponse } from "@mymeetingapp/shared";

import { sendWrite } from "@/api/client";

// Spec §7: every tag, suggestion still linked, rate-limit, audit and attestation row for this phone. It has no body,
// and works below the minimum version and with tagging switched off.
export const deleteMine = () => sendWrite(DeleteMineResponse, "POST", "/api/v1/tags/delete-mine");

// Spec §2: the body is exactly the contract's fields, parsed first, so nothing else about the phone can ride along.
export const submitTags = (request: TagSubmissionRequest) =>
  sendWrite(TagWriteResponse, "POST", "/api/v1/tags", TagSubmissionRequest.parse(request));
