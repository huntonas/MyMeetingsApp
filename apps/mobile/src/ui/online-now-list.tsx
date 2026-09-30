import { OnlineMeetingsResponse } from "@mymeetingapp/shared";
import { useCallback } from "react";
import { ActivityIndicator, View } from "react-native";

import { fetchOnlineMeetings } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";
import { useRefreshOnFocus } from "@/cache/use-refresh-on-focus";
import { onlineNow, type TimedMeeting } from "@/meetings/online-now";
import { clockLabel } from "@/time/clock";
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

// The phone's own clock: the Online tab converts every meeting to it.
const local = (start: Date) => clockLabel(start.getHours(), start.getMinutes());

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
    <View accessibilityLabel={title} style={{ gap: 12 }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {items.map(({ meeting, start }) => (
        <MeetingCard key={meeting.id} meeting={meeting} when={`${verb} ${local(start)}`} />
      ))}
    </View>
  );
}

// A meeting's own weekday can differ from the phone's by one, so it reads the phone's yesterday, today and tomorrow.
export function OnlineNowList() {
  const today = new Date().getDay();
  const { state: yesterday, refresh: refreshYesterday } = useCachedRead(onlineRead((today + 6) % 7));
  const { state: current, refresh: refreshToday } = useCachedRead(onlineRead(today));
  const { state: tomorrow, refresh: refreshTomorrow } = useCachedRead(onlineRead((today + 1) % 7));
  const refreshAll = useCallback(() => {
    refreshYesterday();
    refreshToday();
    refreshTomorrow();
  }, [refreshYesterday, refreshToday, refreshTomorrow]);
  useRefreshOnFocus(refreshAll);

  const states = [yesterday, current, tomorrow];
  if (states.some((state) => state.status === "loading")) {
    return <ActivityIndicator accessibilityLabel="Loading online meetings" />;
  }
  const failure = states.flatMap((state) => (state.status === "failed" ? [state.message] : []))[0];
  const ready = states.flatMap((state) => (state.status === "ready" ? [state] : []));
  // Several days can fall back to saved copies at once; the oldest one is the one to warn about.
  const oldest = ready
    .flatMap((state) => (state.savedAt === null ? [] : [state]))
    .sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime())[0];
  const { happening, soon } = onlineNow(
    ready.flatMap((state) => state.data.meetings),
    new Date(),
  );
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
