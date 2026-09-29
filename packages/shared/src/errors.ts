import { z } from "zod";

// Each phase adds the codes its endpoints can return, together with the code that returns them.
const ERROR_CODES = [
  "invalid_request",
  "meeting_not_found",
  "unauthorized",
  "server_error",
  "upgrade_required",
  "attestation_failed",
  "device_blocked",
  "tags_disabled",
  "too_many_tags",
  "unknown_tag",
  "already_tagged",
  "window_closed",
  "rate_limited",
  "not_tagged",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  invalid_request: "Something in that request wasn't right. Please update the app and try again.",
  meeting_not_found: "We couldn't find that meeting. It may have been removed from the meeting list.",
  unauthorized: "You don't have access to this.",
  server_error: "Something went wrong on our end. Please try again in a few minutes.",
  upgrade_required: "This version of the app is too old. Please update it to keep adding tags.",
  attestation_failed:
    "We couldn't confirm this request came from the app. Please update the app and try again.",
  device_blocked: "Tagging isn't available from this device.",
  tags_disabled: "Tagging isn't available for this right now.",
  too_many_tags: "Choose up to 6 tags.",
  unknown_tag: "One of those tags isn't available anymore. Refresh the list and try again.",
  already_tagged: "You've already tagged this meeting in the last 7 days. You can edit your tags instead.",
  window_closed: "New tags can be added from the start of the meeting until 36 hours after.",
  rate_limited: "You've reached today's limit. Please try again tomorrow.",
  not_tagged: "You haven't tagged this meeting.",
};

export const ApiErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
