import { ERROR_MESSAGES, type MeetingSummary, type TagWriteResponse } from "@mymeetingapp/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AccessibilityInfo, View } from "react-native";

import { submitTags } from "@/api/writes";
import { useFeatures, useUpgradeRequired } from "@/config/upgrade";
import { useVocabularyTags, type VocabularyTag } from "@/meetings/vocabulary";
import { type MyTags, myTagsOn, recordSubmission } from "@/tagging/my-tags";
import { confirmedThisWeek, taggingOpen } from "@/tagging/window";
import { civilDateOf, dateLabel } from "@/time/civil-date";
import { useNow } from "@/time/use-now";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { TagPanel } from "@/ui/tag-panel";

// "Welcoming · Coffee": a tag the phone no longer has a name for is left out rather than shown as a slug.
function tagNames(slugs: readonly string[], labels: ReadonlyMap<string, VocabularyTag>): string {
  return slugs.flatMap((slug) => labels.get(slug)?.label ?? []).join(" · ");
}

// Why the phone offers no new submission now, or null when it does. "" means there's nothing worth saying (What
// people say already explains an opted-out group; a phone that tagged this week edits instead).
function whyNoNewTags(
  meeting: MeetingSummary,
  record: MyTags | null,
  now: Date,
  tagging: boolean,
  upgradeRequired: boolean,
): string | null {
  if (meeting.tagsDisabled) return "";
  if (!tagging) return ERROR_MESSAGES.tags_disabled;
  if (upgradeRequired) return ERROR_MESSAGES.upgrade_required;
  if (meeting.timezone === null)
    return "This meeting's listing doesn't give its time zone, so it can't be tagged.";
  if (record !== null && confirmedThisWeek(record.confirmedAt, now)) return "";
  if (!taggingOpen({ ...meeting, timezone: meeting.timezone }, now))
    return record === null ? "You can add tags from the start of this meeting until 36 hours after." : "";
  return null;
}

interface YourTagsProps {
  meeting: MeetingSummary;
  // The server's answer to a write: the page shows its counts.
  onAnswered: (response: TagWriteResponse) => void;
}

// Spec §8: "Tag this meeting" in the tagging window, and the phone's own record of what it tagged.
export function YourTags({ meeting, onAnswered }: YourTagsProps) {
  const now = useNow();
  const features = useFeatures();
  const upgradeRequired = useUpgradeRequired();
  const labels = useVocabularyTags();
  const [record, setRecord] = useState<MyTags | null>();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Read again on focus: "Delete all my tags" on the Me tab may have cleared it.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      myTagsOn(meeting.id).then(
        (found) => {
          if (live) setRecord(found);
        },
        () => {
          if (live) setRecord(null);
        },
      );
      return () => {
        live = false;
      };
    }, [meeting.id]),
  );
  if (record === undefined) return null;
  const tell = (text: string) => {
    setNotice(text);
    AccessibilityInfo.announceForAccessibility(text);
  };
  const submit = async (tags: string[]) => {
    const response = await submitTags({ meetingId: meeting.id, tags });
    const at = new Date();
    // The server has the tags either way; a phone that can't save its record finds out later (already_tagged).
    await recordSubmission({ id: response.meetingId, name: meeting.name }, tags, at).catch(() => undefined);
    setRecord({ meetingId: response.meetingId, name: meeting.name, tags, confirmedAt: at, updatedAt: at });
    setOpen(false);
    onAnswered(response);
    tell("Thanks. Your tags are added.");
  };
  const why = whyNoNewTags(meeting, record, now, features.tagging, upgradeRequired);
  return (
    <View style={{ gap: 8 }}>
      {record !== null && (
        <>
          <AppText variant="label">{`Your tags: ${tagNames(record.tags, labels)}`}</AppText>
          <AppText tone="muted">{`Added ${dateLabel(civilDateOf(record.confirmedAt))}`}</AppText>
        </>
      )}
      {notice !== null && <AppText accessibilityRole="alert">{notice}</AppText>}
      {open ? (
        <TagPanel
          initial={record?.tags ?? []}
          onSubmit={submit}
          onCancel={() => {
            setOpen(false);
          }}
        />
      ) : why === null ? (
        <Button
          label="Tag this meeting"
          hint="For a meeting you went to: choose words that describe it"
          onPress={() => {
            setNotice(null);
            setOpen(true);
          }}
        />
      ) : (
        why !== "" && <AppText tone="muted">{why}</AppText>
      )}
    </View>
  );
}
