import { View } from "react-native";

import type { FallbackReason } from "@/cache/cached-read";
import { savedAtLabel } from "@/cache/saved-at";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

// Distinct wording for why the copy on screen is old: a connection problem versus the server itself struggling
// (owner ruling M2, 2026-09-29). Both keep the calm tone and still show when the copy was saved.
const REASON_TEXT: Record<FallbackReason, string> = {
  unreachable: "We couldn't reach mymeetingapp, so it may be out of date.",
  serverError: "mymeetingapp is having trouble right now, so it may be out of date.",
};

// Owner decision 5: data older than the website's catch-up promise is shown only offline, and always says so.
export function SavedCopyNote({ savedAt, reason }: { savedAt: Date; reason: FallbackReason }) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: colors.noticeBg, padding: 12, borderRadius: 8 }}
    >
      <AppText variant="small">
        {`Showing the copy saved ${savedAtLabel(savedAt, new Date())}. ${REASON_TEXT[reason]}`}
      </AppText>
    </View>
  );
}
