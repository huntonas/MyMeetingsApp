import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable } from "react-native";

import { isFavorite, setFavorite } from "@/saved/favorites";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

// Favorites stay on the phone (spec §2): saving sends nothing anywhere. Until the phone has said whether the meeting
// is saved, there's no heart rather than a wrong one; a failed read or write leaves the heart as it was.
export function SaveButton({ meetingId }: { meetingId: string }) {
  const colors = useColors();
  const [saved, setSaved] = useState<boolean | null>(null);
  useEffect(() => {
    void isFavorite(meetingId)
      .then(setSaved)
      .catch(() => undefined);
  }, [meetingId]);
  if (saved === null) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? "Saved" : "Save"}
      accessibilityHint={
        saved ? "Removes it from your saved meetings" : "Keeps it on this phone, for offline use too"
      }
      accessibilityState={{ selected: saved }}
      onPress={() => {
        void setFavorite(meetingId, !saved)
          .then(() => {
            setSaved(!saved);
          })
          .catch(() => undefined);
      }}
      style={{ minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center", gap: 6 }}
    >
      <Ionicons name={saved ? "heart" : "heart-outline"} size={24} color={colors.accent} />
      <AppText variant="label" style={{ color: colors.accent }}>
        {saved ? "Saved" : "Save"}
      </AppText>
    </Pressable>
  );
}
