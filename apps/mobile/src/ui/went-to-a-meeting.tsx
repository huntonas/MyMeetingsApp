import type { MeetingSearchResponse } from "@mymeetingapp/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { useFeatures, useUpgradeRequired } from "@/config/upgrade";
import type { LatLng } from "@/location/geo";
import { shortWhen } from "@/meetings/schedule";
import { milesLabel } from "@/meetings/units";
import { meetingsToTag } from "@/search/nearby";
import { allMyTags, type MyTags } from "@/tagging/my-tags";
import { whyNoNewTags } from "@/tagging/window";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { MeetingCard } from "@/ui/meeting-card";

// The meeting just left and one before it: any more would push tonight's meetings off the first screen (owner ruling,
// 2026-10-04).
const SHOWN = 2;

// The phone's tag record by meeting, read again each time Nearby comes into view (a meeting page may have added to
// it); undefined until read. A record that can't be read counts as none: the meeting's page reads it again before
// offering anything.
function useMyTagRecords(): ReadonlyMap<string, MyTags> | undefined {
  const [records, setRecords] = useState<ReadonlyMap<string, MyTags>>();
  useFocusEffect(
    useCallback(() => {
      let live = true;
      allMyTags().then(
        (found) => {
          if (live) setRecords(new Map(found.map((record) => [record.meetingId, record])));
        },
        () => {
          if (live) setRecords(new Map());
        },
      );
      return () => {
        live = false;
      };
    }, []),
  );
  return records;
}

interface WentToAMeetingProps {
  // The search's whole answer: the server sends each place's meetings whatever their time.
  meetings: MeetingSearchResponse["meetings"];
  from: LatLng;
  now: Date;
}

// Owner decision, 2026-10-04: right after a meeting the starting list has moved on from it, so Nearby's list offers
// the meetings nearby that their pages would offer to tag now, the latest start first. Each opens its page, where
// "Tag this meeting" is.
export function WentToAMeeting({ meetings, from, now }: WentToAMeetingProps) {
  const features = useFeatures();
  const upgradeRequired = useUpgradeRequired();
  const records = useMyTagRecords();
  const [all, setAll] = useState(false);
  const toTag = useMemo(
    () =>
      records === undefined
        ? []
        : meetingsToTag(
            meetings,
            from,
            now,
            (meeting) =>
              whyNoNewTags(
                meeting,
                records.get(meeting.id) ?? null,
                now,
                features.tagging,
                upgradeRequired,
              ) === null,
          ),
    [meetings, from, now, records, features.tagging, upgradeRequired],
  );
  if (toTag.length === 0) return null;
  const more = toTag.length - SHOWN;
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="heading" accessibilityRole="header">
        Went to a meeting? Tag it
      </AppText>
      <AppText tone="muted">Started in the last 36 hours.</AppText>
      {(all ? toTag : toTag.slice(0, SHOWN)).map((meeting) => (
        <MeetingCard
          key={meeting.id}
          meeting={meeting}
          when={shortWhen(meeting)}
          distance={milesLabel(meeting.exactKm)}
        />
      ))}
      {more > 0 && (
        <View style={{ alignSelf: "flex-start" }}>
          <Button
            kind="text"
            label={all ? "Show fewer" : `Show ${String(more)} more`}
            hint={all ? "Lists only the latest two" : "Lists every meeting nearby you can tag now"}
            onPress={() => {
              setAll(!all);
            }}
          />
        </View>
      )}
    </View>
  );
}
