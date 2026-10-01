import { CATCH_UP_MINUTES } from "@mymeetingapp/shared";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";

import { failureMessage } from "@/api/failure-message";
import { deleteMine } from "@/api/writes";
import { forgetAllMyTags } from "@/tagging/my-tags";
import { AppText } from "@/ui/app-text";
import { ConfirmButton } from "@/ui/confirm-button";

const OFFLINE = "We couldn't reach mymeetingapp to finish deleting. Check your connection and try again.";
const RECORD_KEPT = "This phone couldn't clear its own list of tagged meetings. Try again.";

function deleted(count: number): string {
  if (count === 0)
    return "Our server held no tags from this phone, and anything else it kept for this phone is deleted.";
  return `Deleted your tags on ${String(count)} ${count === 1 ? "meeting" : "meetings"}, and everything else our server kept for this phone. Counts in the app catch up within ${String(CATCH_UP_MINUTES.app)} minutes.`;
}

// Spec §8's "delete all my tags", in the words the website promises. It works for every app version and with tagging
// switched off, like the server route. The phone's own record is cleared only once the server confirms (owner decision
// 6, 2026-10-01), and `onDeleted` then tells the screen to read it again.
export function DeleteAllMyTags({ onDeleted }: { onDeleted: () => void }) {
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
              async ({ deletedTags }) => {
                const cleared = await forgetAllMyTags().then(
                  () => true,
                  () => false,
                );
                finish(cleared ? deleted(deletedTags) : `${deleted(deletedTags)} ${RECORD_KEPT}`);
                onDeleted();
              },
              (error: unknown) => {
                finish(failureMessage(error, OFFLINE));
              },
            );
          }}
        />
      )}
      {result !== null && <AppText accessibilityRole="alert">{result}</AppText>}
    </View>
  );
}
