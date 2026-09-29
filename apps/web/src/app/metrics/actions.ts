"use server";

import { adminAction } from "@/app/metrics/admin-action";
import {
  FeedOptOutForm,
  MeetingOptOutForm,
  setFeedOptedOut,
  setMeetingTagsDisabled,
} from "@/server/admin/opt-outs";
import {
  approveSuggestion,
  ApproveSuggestionForm,
  mergeSuggestion,
  MergeSuggestionForm,
  rejectSuggestion,
  RejectSuggestionForm,
} from "@/server/admin/suggestions";
import { blockSwingDevice, BlockSwingDeviceForm, closeSwing, CloseSwingForm } from "@/server/admin/swings";
import { setTagRetired, TagStatusForm } from "@/server/admin/vocabulary";

// Every admin Server Action. Each one is adminAction(page to return to, form, change).
export const approveSuggestionAction = adminAction(
  "/metrics/suggestions",
  ApproveSuggestionForm,
  approveSuggestion,
);
export const mergeSuggestionAction = adminAction(
  "/metrics/suggestions",
  MergeSuggestionForm,
  mergeSuggestion,
);
export const rejectSuggestionAction = adminAction(
  "/metrics/suggestions",
  RejectSuggestionForm,
  rejectSuggestion,
);
export const blockSwingDeviceAction = adminAction(
  (input) => `/metrics/swings/${String(input.swingId)}`,
  BlockSwingDeviceForm,
  blockSwingDevice,
);
export const closeSwingAction = adminAction("/metrics/swings", CloseSwingForm, closeSwing);
export const setMeetingTagsAction = adminAction(
  "/metrics/opt-outs",
  MeetingOptOutForm,
  setMeetingTagsDisabled,
);
export const setFeedOptOutAction = adminAction("/metrics/opt-outs", FeedOptOutForm, setFeedOptedOut);
export const setTagRetiredAction = adminAction("/metrics/vocabulary", TagStatusForm, setTagRetired);
