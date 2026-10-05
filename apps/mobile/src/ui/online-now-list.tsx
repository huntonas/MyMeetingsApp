import { OnlineMeetingsResponse } from "@mymeetingapp/shared";
import { useCallback, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";

import { fetchOnlineMeetings } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";
import { useRefreshOnFocus } from "@/cache/use-refresh-on-focus";
import { onlineNow, type TimedMeeting } from "@/meetings/online-now";
import { phoneClockLabel } from "@/time/clock";
import { useNow } from "@/time/use-now";
import { AppText } from "@/ui/app-text";
import { MeetingCard } from "@/ui/meeting-card";
import { SavedCopyNote } from "@/ui/saved-copy-note";

const onlineRead = (day: number) =>
  ({
    kind: "onlineMeetings",
    key: `online:${String(day)}`,
    schema: OnlineMeetingsResponse,
    fetch: () => fetchOnlineMeetings(day),
  }) as const;

function Section({
  title,
  items,
  verb,
}: {
  title: string;
  items: TimedMeeting[];
  verb: "Started" | "Starts";
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {items.map(({ meeting, start }) => (
        <MeetingCard key={meeting.id} meeting={meeting} when={`${verb} ${phoneClockLabel(start)}`} />
      ))}
    </View>
  );
}

// The online meetings in progress and starting soon (Spec §8 "Online now"), with how the reads went. A meeting's own
// weekday can differ from the phone's by one, so it reads the phone's yesterday, today and tomorrow.
export function useOnlineNow() {
  const now = useNow();
  const today = now.getDay();
  const { state: yesterday, refresh: refreshYesterday } = useCachedRead(onlineRead((today + 6) % 7));
  const { state: current, refresh: refreshToday } = useCachedRead(onlineRead(today));
  const { state: tomorrow, refresh: refreshTomorrow } = useCachedRead(onlineRead((today + 1) % 7));
  const refreshAll = useCallback(() => {
    refreshYesterday();
    refreshToday();
    refreshTomorrow();
  }, [refreshYesterday, refreshToday, refreshTomorrow]);
  useRefreshOnFocus(refreshAll);

  const states = useMemo(() => [yesterday, current, tomorrow], [yesterday, current, tomorrow]);
  const ready = useMemo(() => states.flatMap((state) => (state.status === "ready" ? [state] : [])), [states]);
  const { happening, soon } = useMemo(
    () =>
      onlineNow(
        ready.flatMap((state) => state.data.meetings),
        now,
      ),
    [ready, now],
  );
  const loading = states.some((state) => state.status === "loading");
  const failure = states.flatMap((state) => (state.status === "failed" ? [state.message] : []))[0];
  // Several days can fall back to saved copies at once; the oldest one is the one to warn about.
  const oldest = ready
    .flatMap((state) => (state.savedAt === null ? [] : [state]))
    .sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime())[0];
  return { loading, failure, oldest, happening, soon };
}

export function OnlineNowList() {
  const { loading, failure, oldest, happening, soon } = useOnlineNow();
  if (loading) return <ActivityIndicator accessibilityLabel="Loading online meetings" />;
  return (
    <View style={{ gap: 20 }}>
      {failure !== undefined && <AppText>{failure}</AppText>}
      {oldest !== undefined && <SavedCopyNote savedAt={oldest.savedAt} reason={oldest.reason} />}
      {happening.length === 0 && soon.length === 0 && failure === undefined && (
        <AppText>No online meetings are happening right now.</AppText>
      )}
      <Section title="Happening now" items={happening} verb="Started" />
      <Section title="Starting in the next 2 hours" items={soon} verb="Starts" />
    </View>
  );
}
