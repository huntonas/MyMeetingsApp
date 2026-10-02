import { BRAND } from "@mymeetingapp/shared";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { GENERIC_FAILURE } from "@/api/failure-message";
import { type AttendanceAnswer, checkAttendance } from "@/location/attendance";
import type { LatLng } from "@/location/geo";
import { recordNear, wasNear } from "@/tagging/attendance-record";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { useNotice } from "@/ui/notice";

const ANSWERS: Record<AttendanceAnswer, string> = {
  near: "You're near the meeting. Your tags will say so.",
  notNear: "You don't seem to be at the meeting, so your tags will go without that.",
  denied: `Location isn't allowed for ${BRAND.name}, so your tags will go without the check.`,
  approximate: "Only your approximate location is shared, so your tags will go without the check.",
  unavailable: "Your phone couldn't find where it is, so your tags will go without the check.",
};

interface AttendanceOfferProps {
  meetingId: string;
  place: LatLng;
  // The occurrence the check counts for (attendanceOccurrence).
  occurrenceStart: Date;
}

const EXPLANATION = "We check you're near the meeting to stop spam. Your location never leaves your phone.";

// Spec §8: the tag picker offers the attendance check, with the spec's explanation. A tap may ask for permission and
// precise location; only a "near" answer is kept, and only the answer, never the position.
export function AttendanceOffer({ meetingId, place, occurrenceStart }: AttendanceOfferProps) {
  // Whether a check already found the phone near for this occurrence; undefined until read. A result that can't be
  // read counts as none, so the check is offered rather than claimed.
  const [near, setNear] = useState<boolean>();
  const [checking, setChecking] = useState(false);
  const answer = useNotice();
  // The parent works the occurrence out on each render, so the effect follows its instant, not the Date object.
  const start = occurrenceStart.getTime();
  useEffect(() => {
    let live = true;
    wasNear(meetingId, new Date(start)).then(
      (found) => {
        if (live) setNear(found);
      },
      () => {
        if (live) setNear(false);
      },
    );
    return () => {
      live = false;
    };
  }, [meetingId, start]);
  const check = () => {
    setChecking(true);
    answer.tell(null);
    void (async () => {
      const result = await checkAttendance(place, "tap");
      // A near result the phone can't keep would never be sent, so it isn't claimed.
      const kept =
        result !== "near" ||
        (await recordNear(meetingId, new Date(start)).then(
          () => true,
          () => false,
        ));
      setChecking(false);
      setNear(result === "near" && kept);
      answer.tell(kept ? ANSWERS[result] : GENERIC_FAILURE);
    })();
  };
  return (
    <View style={{ gap: 8 }}>
      <AppText tone="muted">{EXPLANATION}</AppText>
      {near === true && answer.text === null && <AppText>{ANSWERS.near}</AppText>}
      {answer.text !== null && <AppText accessibilityRole="alert">{answer.text}</AppText>}
      {checking ? (
        <ActivityIndicator accessibilityLabel="Checking where you are" />
      ) : (
        near === false && (
          <Button
            kind="secondary"
            label="Check I'm near the meeting"
            hint="Uses your location once, on this phone"
            onPress={check}
          />
        )
      )}
    </View>
  );
}
