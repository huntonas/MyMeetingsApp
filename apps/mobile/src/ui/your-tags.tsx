import {
  ERROR_MESSAGES,
  type ErrorCode,
  type MeetingSummary,
  type TagWriteResponse,
} from "@mymeetingapp/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, type Text, View } from "react-native";

import { ApiError } from "@/api/client";
import { failureMessage } from "@/api/failure-message";
import { editTags, removeTags, submitTags } from "@/api/writes";
import { useFeatures, useUpgradeRequired } from "@/config/upgrade";
import { useVocabularyTags, type VocabularyTag } from "@/meetings/vocabulary";
import { forgetMyTags, type MyTags, myTagsOn, recordEdit, recordSubmission } from "@/tagging/my-tags";
import { confirmedThisWeek, taggingOpen } from "@/tagging/window";
import { civilDateOf, dateLabel } from "@/time/civil-date";
import { useNow } from "@/time/use-now";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { ConfirmButton } from "@/ui/confirm-button";
import { moveFocus } from "@/ui/move-focus";
import { TagPanel } from "@/ui/tag-panel";

// "Welcoming · Coffee": a tag the phone no longer has a name for is left out rather than shown as a slug.
export function tagNames(slugs: readonly string[], labels: ReadonlyMap<string, VocabularyTag>): string {
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

// A removal that timed out may still have reached the server, so this can't say the tags are still there.
const OFFLINE_REMOVE =
  "We couldn't reach mymeetingapp, so we can't tell whether your tags were removed. Check your connection and try again.";

// The server holds no tags from this phone on the meeting (or knows no such meeting): the phone's record is stale.
const NOTHING_TO_REMOVE: readonly ErrorCode[] = ["not_tagged", "meeting_not_found"];

// The phone's record for the meeting, read again on focus ("Delete all my tags" on the Me tab may have cleared it);
// undefined until read.
function useMyTags(meetingId: string) {
  const [record, setRecord] = useState<MyTags | null>();
  useFocusEffect(
    useCallback(() => {
      let live = true;
      myTagsOn(meetingId).then(
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
    }, [meetingId]),
  );
  return [record, setRecord] as const;
}

// What a write did, shown and announced.
function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const tell = useCallback((text: string | null) => {
    setNotice(text);
    if (text !== null) AccessibilityInfo.announceForAccessibility(text);
  }, []);
  return [notice, tell] as const;
}

interface RemoveButtonProps {
  meetingId: string;
  // The record is gone: the server removed the tags (its answer, with the new counts), or held none (null).
  onRemoved: (response: TagWriteResponse | null) => void;
  tell: (text: string) => void;
}

// Spec §5: deletes work at any time, so this is offered whenever the phone has a record, whatever the switches.
function RemoveButton({ meetingId, onRemoved, tell }: RemoveButtonProps) {
  const [removing, setRemoving] = useState(false);
  if (removing) return <ActivityIndicator accessibilityLabel="Removing your tags" />;
  const remove = async () => {
    try {
      const response = await removeTags(meetingId);
      // The server has removed them either way; a record the phone can't forget is refused as not_tagged next time.
      await forgetMyTags(meetingId).catch(() => undefined);
      onRemoved(response);
      tell("Your tags are removed.");
    } catch (error) {
      if (error instanceof ApiError && NOTHING_TO_REMOVE.includes(error.code)) {
        await forgetMyTags(meetingId).catch(() => undefined);
        onRemoved(null);
      }
      tell(failureMessage(error, OFFLINE_REMOVE));
    }
    setRemoving(false);
  };
  return (
    <ConfirmButton
      label="Remove my tags"
      hint="Asks before removing this phone's tags from this meeting"
      question="Remove your tags from this meeting? Other people's tags stay."
      confirmLabel="Remove my tags"
      confirmHint="Removes them from our server now"
      cancelLabel="Keep them"
      onConfirm={() => {
        setRemoving(true);
        void remove();
      }}
    />
  );
}

interface YourTagsProps {
  meeting: MeetingSummary;
  // The server's answer to a write: the page shows its counts, and follows the meeting if it merged meanwhile.
  onAnswered: (response: TagWriteResponse) => void;
}

// Spec §8: "Tag this meeting" in the tagging window, the phone's own record of what it tagged, and "Edit my tags" /
// "Remove my tags" whenever it has one.
export function YourTags({ meeting, onAnswered }: YourTagsProps) {
  const now = useNow();
  const features = useFeatures();
  const upgradeRequired = useUpgradeRequired();
  const labels = useVocabularyTags();
  const [record, setRecord] = useMyTags(meeting.id);
  const [open, setOpen] = useState<"new" | "edit" | null>(null);
  const [notice, tell] = useNotice();
  const recordLine = useRef<Text>(null);
  const tagButton = useRef<View>(null);
  // Set when the picker closes, so focus goes back to the page (the record line, or the button) once it's drawn.
  const closed = useRef(false);
  useEffect(() => {
    if (open !== null || !closed.current) return;
    closed.current = false;
    moveFocus(recordLine.current === null ? tagButton : recordLine);
  }, [open]);
  if (record === undefined) return null;
  const close = () => {
    closed.current = true;
    setOpen(null);
  };
  const openPanel = (mode: "new" | "edit") => {
    tell(null);
    setOpen(mode);
  };
  const submit = async (tags: string[]) => {
    const response = await submitTags({ meetingId: meeting.id, tags });
    const at = new Date();
    // The server has the tags either way; a phone that can't save its record finds out later (already_tagged).
    await recordSubmission({ id: response.meetingId, name: meeting.name }, tags, at).catch(() => undefined);
    setRecord({ meetingId: response.meetingId, name: meeting.name, tags, confirmedAt: at, updatedAt: at });
    close();
    onAnswered(response);
    tell("Thanks. Your tags are added.");
  };
  const edit = async (tags: string[]) => {
    let response: TagWriteResponse;
    try {
      response = await editTags(meeting.id, tags);
    } catch (error) {
      // The server holds no tags from this phone here: the record is stale, and the panel says the server's words.
      if (error instanceof ApiError && error.code === "not_tagged") {
        await forgetMyTags(meeting.id).catch(() => undefined);
        setRecord(null);
      }
      throw error;
    }
    const at = new Date();
    // Filed under this page's meeting even if the server answered for one it merged into: the page then moves the
    // record along with everything else (onAnswered), keeping its first date.
    await recordEdit({ id: meeting.id, name: meeting.name }, tags, at).catch(() => undefined);
    setRecord({
      meetingId: meeting.id,
      name: meeting.name,
      tags,
      confirmedAt: record?.confirmedAt ?? at,
      updatedAt: at,
    });
    close();
    onAnswered(response);
    tell("Your tags are saved.");
  };
  const why = whyNoNewTags(meeting, record, now, features.tagging, upgradeRequired);
  // Spec §8 with the owner's 2026-10-01 ruling: Edit only while the server would accept it.
  const editable = record !== null && !meeting.tagsDisabled && features.tagging && !upgradeRequired;
  return (
    <View style={{ gap: 8 }}>
      {record !== null && (
        <>
          <AppText ref={recordLine} variant="label">{`Your tags: ${tagNames(record.tags, labels)}`}</AppText>
          <AppText tone="muted">{`Added ${dateLabel(civilDateOf(record.confirmedAt))}`}</AppText>
        </>
      )}
      {notice !== null && <AppText accessibilityRole="alert">{notice}</AppText>}
      {open !== null ? (
        <TagPanel mode={open} initial={record?.tags ?? []} onSubmit={submit} onEdit={edit} onCancel={close} />
      ) : (
        <>
          {why === null ? (
            <Button
              ref={tagButton}
              label="Tag this meeting"
              hint="For a meeting you went to: choose words that describe it"
              onPress={() => {
                openPanel("new");
              }}
            />
          ) : (
            why !== "" && <AppText tone="muted">{why}</AppText>
          )}
          {editable && (
            <Button
              kind="secondary"
              label="Edit my tags"
              hint="Change the tags this phone added"
              onPress={() => {
                openPanel("edit");
              }}
            />
          )}
          {record !== null && (
            <RemoveButton
              meetingId={meeting.id}
              tell={tell}
              onRemoved={(response) => {
                setRecord(null);
                if (response !== null) onAnswered(response);
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

// For a meeting that's no longer listed: its page has nothing else to show, but the tags this phone added to it can
// still be removed (the server accepts deletes on archived meetings).
export function RemoveMyTags({ meetingId }: { meetingId: string }) {
  const [record, setRecord] = useMyTags(meetingId);
  const [notice, tell] = useNotice();
  return (
    <View style={{ gap: 8 }}>
      {notice !== null && <AppText accessibilityRole="alert">{notice}</AppText>}
      {record !== undefined && record !== null && (
        <RemoveButton
          meetingId={meetingId}
          tell={tell}
          onRemoved={() => {
            setRecord(null);
          }}
        />
      )}
    </View>
  );
}
