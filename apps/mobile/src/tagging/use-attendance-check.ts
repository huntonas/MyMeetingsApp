import type { V1MeetingSummary } from "@mymeetingapp/shared";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

import { useFeatures, useFeaturesKnown, useUpgradeRequired } from "@/config/upgrade";
import { checkAttendance } from "@/location/attendance";
import { recordNear, wasNear } from "@/tagging/attendance-record";
import { attendanceOccurrence, checkablePlace } from "@/tagging/window";

// Spec §8: opening a meeting's page during its time, with location already allowed, checks proximity on the phone.
// Silent: no dialog, nothing shown, best effort. Only a "near" result is kept. It waits for the config and, as a new
// tagging would, skips a group that opted out, tagging switched off and an app below the minimum version (offline
// with no config it still checks, as writes still go). Keyed on the meeting's own fields rather than the object, so
// new tag counts on the page never start a second look.
export function useAttendanceCheck(meeting: V1MeetingSummary): void {
  const known = useFeaturesKnown();
  const { tagging } = useFeatures();
  const upgradeRequired = useUpgradeRequired();
  const { id, attendance, latitude, longitude, timezone, day, time, endTime, tagsDisabled } = meeting;
  useFocusEffect(
    useCallback(() => {
      if (!known || !tagging || upgradeRequired || tagsDisabled || timezone === null) return;
      const place = checkablePlace({ attendance, latitude, longitude });
      if (place === null) return;
      const occurrence = attendanceOccurrence({ day, time, endTime, timezone }, new Date());
      if (occurrence === null) return;
      void (async () => {
        if (await wasNear(id, occurrence.start)) return;
        if ((await checkAttendance(place, "open")) === "near") await recordNear(id, occurrence.start);
      })().catch(() => undefined);
    }, [
      known,
      tagging,
      upgradeRequired,
      id,
      attendance,
      latitude,
      longitude,
      timezone,
      day,
      time,
      endTime,
      tagsDisabled,
    ]),
  );
}
