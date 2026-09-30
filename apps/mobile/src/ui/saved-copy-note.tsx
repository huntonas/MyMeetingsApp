import { View } from "react-native";

import { savedAtLabel } from "@/cache/saved-at";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

// Owner decision 5: data older than the website's catch-up promise is shown only offline, and always says so.
export function SavedCopyNote({ savedAt }: { savedAt: Date }) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: colors.noticeBg, padding: 12, borderRadius: 8 }}
    >
      <AppText variant="small">
        {`Showing the copy saved ${savedAtLabel(savedAt, new Date())}. We couldn't reach mymeetingapp, so it may be out of date.`}
      </AppText>
    </View>
  );
}
