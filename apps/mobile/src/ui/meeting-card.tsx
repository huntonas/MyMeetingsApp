import type { MeetingSummary } from "@mymeetingapp/shared";
import { router } from "expo-router";
import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";
import { TagChips } from "@/ui/tag-chips";

// A card in any meeting list: name, when (and how far), place, and the top three tags.
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
  const meta = distance === undefined ? when : `${when} · ${distance}`;
  const spoken = [meeting.name, when, distance, meeting.locationName]
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
      <TagChips tags={meeting.tags.slice(0, 3)} />
    </Pressable>
  );
}
