import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { GENERIC_FAILURE } from "@/api/failure-message";
import { useVocabularyTags } from "@/meetings/vocabulary";
import { allMyTags, type MyTags } from "@/tagging/my-tags";
import { civilDateOf, dateLabel } from "@/time/civil-date";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { tagNames } from "@/ui/your-tags";

// Spec §8's "Meetings I've tagged", from the phone's own record, read again each time the tab comes into view (a
// meeting page may have changed it). Its parent remounts it (a new `key`) when "Delete all my tags" cleared it.
export function MyTaggedMeetings() {
  const labels = useVocabularyTags();
  const [rows, setRows] = useState<MyTags[] | "failed" | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      allMyTags().then(
        (found) => {
          if (live) setRows(found);
        },
        () => {
          if (live) setRows("failed");
        },
      );
      return () => {
        live = false;
      };
    }, []),
  );
  if (rows === null) return null;
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="label" accessibilityRole="header">
        Meetings I&apos;ve tagged
      </AppText>
      {rows === "failed" ? (
        <AppText accessibilityRole="alert">{GENERIC_FAILURE}</AppText>
      ) : rows.length === 0 ? (
        <AppText tone="muted">You haven&apos;t tagged any meetings on this phone.</AppText>
      ) : (
        rows.map((row) => (
          <View key={row.meetingId} style={{ alignItems: "flex-start" }}>
            <Button
              kind="text"
              label={row.name}
              hint="Opens the meeting"
              onPress={() => {
                router.push(`/meeting/${row.meetingId}`);
              }}
            />
            <AppText tone="muted">{`${tagNames(row.tags, labels)} · ${dateLabel(civilDateOf(row.updatedAt))}`}</AppText>
          </View>
        ))
      )}
    </View>
  );
}
