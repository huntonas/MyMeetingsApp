import type { TagCount } from "@mymeetingapp/shared";
import { View } from "react-native";

import { useVocabularyTags } from "@/meetings/vocabulary";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

// Spec §5: a flat list with counts, in the server's order. A slug the phone has no label for (a tag added since the
// list was last read) waits for the next read rather than showing a raw slug.
export function TagChips({ tags }: { tags: readonly TagCount[] }) {
  const colors = useColors();
  const labels = useVocabularyTags();
  const shown = tags.flatMap((tag) => {
    const label = labels.get(tag.slug)?.label;
    return label === undefined ? [] : [{ ...tag, label }];
  });
  if (shown.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {shown.map((tag) => (
        <View
          key={tag.slug}
          accessible
          accessibilityLabel={`${tag.label}, ${String(tag.count)} ${tag.count === 1 ? "person" : "people"}`}
          style={{
            backgroundColor: colors.tagBg,
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 4,
          }}
        >
          <AppText variant="small">
            {`${tag.label} `}
            <AppText variant="small" style={{ fontWeight: "700" }}>
              {String(tag.count)}
            </AppText>
          </AppText>
        </View>
      ))}
    </View>
  );
}
