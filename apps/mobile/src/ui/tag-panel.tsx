import { BRAND, ERROR_MESSAGES, MAX_TAGS_PER_SUBMISSION, TAG_CATEGORIES } from "@mymeetingapp/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type Text, View } from "react-native";

import { ApiError } from "@/api/client";
import { failureMessage } from "@/api/failure-message";
import { CATEGORY_TITLES, useRefreshVocabulary, useVocabularyTags } from "@/meetings/vocabulary";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { moveFocus } from "@/ui/move-focus";
import { useNotice } from "@/ui/notice";
import { Pill } from "@/ui/pill";

// A write that timed out may still have reached the server, so this can't say the tags weren't saved.
const OFFLINE_TAGS = `We couldn't reach ${BRAND.name}, so we can't tell whether your tags were saved. Check your connection and try again.`;

interface TagPanelProps {
  // "new" tags the meeting for this visit; "edit" replaces the tags this phone already has on it. The owner switches
  // it when the server's answer says the other applies; the choices stay.
  mode: "new" | "edit";
  initial: readonly string[];
  // Send the chosen tags as a new tagging or as an edit; each throws when they didn't go through, and the panel says
  // why.
  onSubmit: (tags: string[]) => Promise<void>;
  onEdit: (tags: string[]) => Promise<void>;
  onCancel: () => void;
  // Shown under the tags (the attendance check).
  children?: ReactNode;
}

// Spec §8: up to 6 tags, grouped by category, from the tag list the server serves. Writes aren't optimistic: the
// choices stay until the server answers, and a refusal keeps them with the server's own words.
export function TagPanel({ mode, initial, onSubmit, onEdit, onCancel, children }: TagPanelProps) {
  const vocabulary = useVocabularyTags();
  const refreshVocabulary = useRefreshVocabulary();
  const [chosen, setChosen] = useState<string[]>([...initial]);
  const message = useNotice();
  const [sending, setSending] = useState(false);
  const heading = useRef<Text>(null);
  // Opened in place, so VoiceOver and TalkBack start reading at the picker rather than the button it replaced.
  useEffect(() => {
    moveFocus(heading);
  }, []);
  // A tag retired since it was chosen (the list was read again) is dropped rather than sent.
  const live = chosen.filter((slug) => vocabulary.has(slug));
  const toggle = (slug: string) => {
    message.tell(null);
    if (live.includes(slug)) setChosen(live.filter((other) => other !== slug));
    else if (live.length >= MAX_TAGS_PER_SUBMISSION) message.tell(ERROR_MESSAGES.too_many_tags);
    else setChosen([...live, slug]);
  };
  const send = () => {
    if (live.length === 0) {
      message.tell("Choose at least one tag.");
      return;
    }
    setSending(true);
    message.tell(null);
    (mode === "new" ? onSubmit(live) : onEdit(live))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "unknown_tag") refreshVocabulary();
        message.tell(failureMessage(error, OFFLINE_TAGS));
      })
      .finally(() => {
        setSending(false);
      });
  };
  const tags = [...vocabulary.values()];
  return (
    <View style={{ gap: 12 }}>
      <AppText ref={heading} variant="heading" accessibilityRole="header">
        {mode === "new" ? "Tag this meeting" : "Edit my tags"}
      </AppText>
      {tags.length === 0 ? (
        <AppText tone="muted">Tag names haven't loaded yet. They'll appear when you're back online.</AppText>
      ) : (
        <>
          <AppText tone="muted">{`Choose up to ${String(MAX_TAGS_PER_SUBMISSION)} words that describe this meeting.`}</AppText>
          {TAG_CATEGORIES.map((category) => {
            const inCategory = tags.filter((tag) => tag.category === category);
            if (inCategory.length === 0) return null;
            return (
              <View key={category} style={{ gap: 8 }}>
                <AppText variant="label" accessibilityRole="header">
                  {CATEGORY_TITLES[category]}
                </AppText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {inCategory.map((tag) => (
                    <Pill
                      key={tag.slug}
                      label={tag.label}
                      selected={live.includes(tag.slug)}
                      onPress={() => {
                        toggle(tag.slug);
                      }}
                    />
                  ))}
                </View>
              </View>
            );
          })}
          <AppText>{`${String(live.length)} of ${String(MAX_TAGS_PER_SUBMISSION)} chosen`}</AppText>
          {children}
        </>
      )}
      {message.text !== null && <AppText accessibilityRole="alert">{message.text}</AppText>}
      {sending ? (
        <ActivityIndicator accessibilityLabel="Sending your tags" />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {tags.length > 0 &&
            (mode === "new" ? (
              <Button label="Send my tags" hint="Sends only these tags, for this meeting" onPress={send} />
            ) : (
              <Button label="Save my tags" hint="Replaces this phone's tags on this meeting" onPress={send} />
            ))}
          <Button kind="secondary" label="Cancel" onPress={onCancel} />
        </View>
      )}
    </View>
  );
}
