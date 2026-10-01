import type { MeetingSummary } from "@mymeetingapp/shared";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

import { checkAttendance } from "@/location/attendance";
import { recordNear, wasNear } from "@/tagging/attendance-record";
import { attendanceOccurrence, checkablePlace } from "@/tagging/window";

// Spec §8: opening a meeting's page during its time, with location already allowed, checks proximity on the phone.
// Silent: no dialog, nothing shown, best effort. Only a "near" result is kept. A group that asked not to be tagged is
// never checked; the feature switch isn't consulted, since it reads as on until the config arrives, and the result
// never leaves the phone unless a submission (which the switch does govern) sends it.
export function useAttendanceCheck(meeting: MeetingSummary): void {
  useFocusEffect(
    useCallback(() => {
      const place = checkablePlace(meeting);
      if (meeting.tagsDisabled || place === null || meeting.timezone === null) return;
      const occurrence = attendanceOccurrence({ ...meeting, timezone: meeting.timezone }, new Date());
      if (occurrence === null) return;
      void (async () => {
        if (await wasNear(meeting.id, occurrence.start)) return;
        if ((await checkAttendance(place, "open")) === "near") await recordNear(meeting.id, occurrence.start);
      })().catch(() => undefined);
    }, [meeting]),
  );
}
