"use server";

import { adminAction } from "@/app/metrics/admin-action";
import {
  approveSuggestion,
  ApproveSuggestionForm,
  mergeSuggestion,
  MergeSuggestionForm,
  rejectSuggestion,
  RejectSuggestionForm,
} from "@/server/admin/suggestions";

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
