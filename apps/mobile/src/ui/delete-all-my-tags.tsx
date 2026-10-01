import { CATCH_UP_MINUTES } from "@mymeetingapp/shared";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";

import { writeFailure } from "@/api/write-failure";
import { deleteMine } from "@/api/writes";
import { AppText } from "@/ui/app-text";
import { ConfirmButton } from "@/ui/confirm-button";

const OFFLINE = "We couldn't reach mymeetingapp to finish deleting. Check your connection and try again.";

function deleted(count: number): string {
  if (count === 0)
    return "Our server held no tags from this phone, and anything else it kept for this phone is deleted.";
  return `Deleted your tags on ${String(count)} ${count === 1 ? "meeting" : "meetings"}, and everything else our server kept for this phone. Counts in the app catch up within ${String(CATCH_UP_MINUTES.app)} minutes.`;
}

// Spec §8's "delete all my tags", in the words the website promises. It works for every app version and with tagging
// switched off, like the server route.
export function DeleteAllMyTags() {
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const finish = (message: string) => {
    setDeleting(false);
    setResult(message);
    AccessibilityInfo.announceForAccessibility(message);
  };
  return (
    <View style={{ gap: 8 }}>
      {deleting ? (
        <ActivityIndicator accessibilityLabel="Deleting your tags" />
      ) : (
        <ConfirmButton
          label="Delete all my tags"
          hint="Asks before deleting every tag this phone has added"
          question="Delete every tag this phone has added, on every meeting? This can't be undone."
          confirmLabel="Delete all my tags"
          confirmHint="Deletes them from our server now"
          cancelLabel="Keep them"
          onConfirm={() => {
            setDeleting(true);
            setResult(null);
            deleteMine().then(
              ({ deletedTags }) => {
                finish(deleted(deletedTags));
              },
              (error: unknown) => {
                finish(writeFailure(error, OFFLINE));
              },
            );
          }}
        />
      )}
      {result !== null && <AppText accessibilityRole="alert">{result}</AppText>}
    </View>
  );
}
