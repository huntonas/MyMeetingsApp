import {
  DeleteMineResponse,
  SuggestionRequest,
  SuggestionResponse,
  TagEditRequest,
  TagSubmissionRequest,
  TagWriteResponse,
} from "@mymeetingapp/shared";

import { sendWrite } from "@/api/client";

// Spec §7: every tag, suggestion still linked, rate-limit, audit and attestation row for this phone. It has no body,
// and works below the minimum version and with tagging switched off. The server deletes this phone's App Attest key
// too, so the phone forgets it.
export const deleteMine = () =>
  sendWrite(DeleteMineResponse, "POST", "/api/v1/tags/delete-mine", undefined, {
    forgetsAttestKey: true,
    deletion: true,
  });

// Spec §2: the body is exactly the contract's fields, parsed first, so nothing else about the phone can ride along.
export const submitTags = (request: TagSubmissionRequest) =>
  sendWrite(TagWriteResponse, "POST", "/api/v1/tags", TagSubmissionRequest.parse(request));

// Spec §5: edits keep the original confirmation; deletes have no body, and both work at any time.
export const editTags = (meetingId: string, tags: string[]) =>
  sendWrite(
    TagWriteResponse,
    "PUT",
    `/api/v1/tags/${encodeURIComponent(meetingId)}`,
    TagEditRequest.parse({ tags }),
  );

export const removeTags = (meetingId: string) =>
  sendWrite(TagWriteResponse, "DELETE", `/api/v1/tags/${encodeURIComponent(meetingId)}`, undefined, {
    deletion: true,
  });

// Spec §5: only the suggested words, trimmed. The server screens them and answers only that it received them.
export const suggestTag = (text: string) =>
  sendWrite(SuggestionResponse, "POST", "/api/v1/suggestions", SuggestionRequest.parse({ text }));
