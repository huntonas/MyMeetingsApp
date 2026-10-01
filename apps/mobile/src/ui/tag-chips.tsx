import type { TagCount } from "@mymeetingapp/shared";
import { View } from "react-native";

import { useVocabularyTags } from "@/meetings/vocabulary";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

interface LabelledTag extends TagCount {
  label: string;
  spoken: string;
}

// Spec §5: a flat list with counts, in the server's order. A slug the phone has no label for (a tag added since the
// list was last read) waits for the next read rather than showing a raw slug, so it's dropped before any top-N cut.
export function useLabelledTags(tags: readonly TagCount[]): LabelledTag[] {
  const labels = useVocabularyTags();
  return tags.flatMap((tag) => {
    const label = labels.get(tag.slug)?.label;
    if (label === undefined) return [];
    return [
      { ...tag, label, spoken: `${label} ${String(tag.count)} ${tag.count === 1 ? "person" : "people"}` },
    ];
  });
}

export function TagChips({ tags }: { tags: readonly LabelledTag[] }) {
  const colors = useColors();
  if (tags.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {tags.map((tag) => (
        <View
          key={tag.slug}
          accessible
          accessibilityLabel={tag.spoken}
          style={{
            backgroundColor: colors.tagBg,
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 4,
          }}
        >
          <AppText variant="small">
            {`${tag.label} `}
            <AppText variant="smallBold">{String(tag.count)}</AppText>
          </AppText>
        </View>
      ))}
    </View>
  );
}
