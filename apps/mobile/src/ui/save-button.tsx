import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { GENERIC_FAILURE } from "@/api/failure-message";
import { isFavorite, setFavorite } from "@/saved/favorites";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

// Favorites stay on the phone (spec §2): saving sends nothing anywhere. Until the phone has said whether the meeting
// is saved, there's no heart rather than a wrong one; a failed read or write leaves the heart as it was, and a failed
// write says so, as the sobriety card does.
export function SaveButton({ meetingId }: { meetingId: string }) {
  const colors = useColors();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void isFavorite(meetingId)
      .then(setSaved)
      .catch(() => undefined);
  }, [meetingId]);
  if (saved === null) return null;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={saved ? "Saved" : "Save"}
        accessibilityHint={
          saved ? "Removes it from your saved meetings" : "Keeps it on this phone, for offline use too"
        }
        accessibilityState={{ selected: saved }}
        onPress={() => {
          setFailed(false);
          setFavorite(meetingId, !saved).then(
            () => {
              setSaved(!saved);
            },
            () => {
              setFailed(true);
            },
          );
        }}
        style={{ minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <Ionicons name={saved ? "heart" : "heart-outline"} size={24} color={colors.accent} />
        <AppText variant="label" style={{ color: colors.accent }}>
          {saved ? "Saved" : "Save"}
        </AppText>
      </Pressable>
      {failed && <AppText accessibilityRole="alert">{GENERIC_FAILURE}</AppText>}
    </View>
  );
}
