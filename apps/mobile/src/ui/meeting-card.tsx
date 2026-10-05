import type { MeetingSummary } from "@mymeetingapp/shared";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { fellowshipLabel } from "@/meetings/fellowship";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";
import { TagChips, useLabelledTags } from "@/ui/tag-chips";

// A card in any meeting list: name, its fellowship and when (and how far), place, and the top three tags.
export function MeetingCard({
  meeting,
  when,
  distance,
}: {
  meeting: MeetingSummary;
  when: string;
  distance?: string;
}) {
  const colors = useColors();
  const tags = useLabelledTags(meeting.tags).slice(0, 3);
  const fellowship = fellowshipLabel(meeting.fellowship);
  const meta = [fellowship, when, distance].filter((part) => part !== undefined).join(" · ");
  // The card is one button to VoiceOver and TalkBack, so its label carries everything on it, tags included.
  const spoken = [
    meeting.name,
    `${fellowship} meeting`,
    when,
    distance,
    meeting.locationName,
    ...tags.map((tag) => tag.spoken),
  ]
    .filter((part) => typeof part === "string")
    .join(", ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the meeting's details"
      onPress={() => {
        router.push(`/meeting/${meeting.id}`);
      }}
      style={{
        minHeight: 44,
        padding: 16,
        gap: 6,
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: 12,
      }}
    >
      <AppText variant="label">{meeting.name}</AppText>
      <AppText tone="muted">{meta}</AppText>
      {meeting.locationName !== null && <AppText tone="muted">{meeting.locationName}</AppText>}
      {/* Already in the card's label; hidden so Android doesn't read the chips a second time. */}
      <View accessible={false} importantForAccessibility="no-hide-descendants">
        <TagChips tags={tags} />
      </View>
    </Pressable>
  );
}
