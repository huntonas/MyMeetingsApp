import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { savedCopy } from "@/cache/cached-read";
import { GENERIC_FAILURE } from "@/api/failure-message";
import { useCachedRead } from "@/cache/use-cached-read";
import { useRefreshOnFocus } from "@/cache/use-refresh-on-focus";
import { detailRead } from "@/meetings/detail-read";
import { meetingMoved } from "@/meetings/merged";
import { shortWhen } from "@/meetings/schedule";
import { favoriteIds, setFavorite } from "@/saved/favorites";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { MeetingCard } from "@/ui/meeting-card";
import { SavedCopyNote } from "@/ui/saved-copy-note";
import { Screen } from "@/ui/screen";

// The server no longer has the meeting, so its name comes from the copy saved on the phone, when there is one.
function NoLongerListed({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [name, setName] = useState<string | null>();
  useEffect(() => {
    void savedCopy(detailRead(id)).then((copy) => {
      setName(copy?.data.meeting.name ?? null);
    });
  }, [id]);
  if (name === undefined) return null;
  return (
    <View style={{ gap: 8 }}>
      <AppText>{`${name ?? "This meeting"} is no longer listed.`}</AppText>
      <Button
        kind="secondary"
        label={name === null ? "Remove" : `Remove ${name}`}
        hint="Removes it from your saved meetings"
        onPress={() => {
          // A failed removal leaves the row as it was, to try again.
          void setFavorite(id, false)
            .then(onChanged)
            .catch(() => undefined);
        }}
      />
    </View>
  );
}

// Each saved meeting is read like its page: a copy inside its reuse window is shown without asking the server, so
// coming back to the tab asks only for the meetings whose copies have aged out.
function SavedRow({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { state, refresh } = useCachedRead(detailRead(id));
  useRefreshOnFocus(refresh);
  const survivor = state.status === "ready" ? state.data.meeting.id : id;
  useEffect(() => {
    if (survivor === id) return;
    // Best effort, as on the meeting page: the list is read again either way.
    void meetingMoved(id, survivor, "move")
      .catch(() => undefined)
      .then(onChanged);
  }, [id, survivor, onChanged]);
  if (state.status === "loading") return <ActivityIndicator accessibilityLabel="Loading a saved meeting" />;
  if (state.status === "failed") {
    if (!state.gone) return <AppText accessibilityRole="alert">{state.message}</AppText>;
    return <NoLongerListed id={id} onChanged={onChanged} />;
  }
  const { meeting } = state.data;
  return (
    <View style={{ gap: 8 }}>
      {state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} reason={state.reason} />}
      <MeetingCard meeting={meeting} when={shortWhen(meeting)} />
    </View>
  );
}

export default function SavedScreen() {
  const [ids, setIds] = useState<string[] | "failed" | null>(null);
  const reload = useCallback(() => {
    void favoriteIds()
      .then(setIds)
      .catch(() => {
        setIds("failed");
      });
  }, []);
  // Saving happens on a meeting's page, so the list is read again each time the tab comes back into view.
  useFocusEffect(reload);
  if (ids === null) return <ActivityIndicator accessibilityLabel="Loading saved meetings" />;
  if (ids === "failed") {
    return (
      <Screen>
        <AppText accessibilityRole="alert">{GENERIC_FAILURE}</AppText>
      </Screen>
    );
  }
  if (ids.length === 0) {
    return (
      <Screen>
        <AppText>Meetings you save appear here.</AppText>
        <AppText tone="muted">
          Tap Save on a meeting&apos;s page. Saved meetings stay on this phone and work offline.
        </AppText>
      </Screen>
    );
  }
  return (
    <Screen>
      {ids.map((id) => (
        <SavedRow key={id} id={id} onChanged={reload} />
      ))}
    </Screen>
  );
}
