import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AccessibilityInfo, Platform, View } from "react-native";

import { GENERIC_FAILURE } from "@/cache/use-cached-read";
import { breakdownLabel, milestoneToday, nextMilestone, plural, soberTime } from "@/sobriety/counter";
import { clearSobrietyDate, readSobrietyDate, saveSobrietyDate } from "@/sobriety/sobriety-date";
import { type CivilDate, civilDateOf, dateLabel } from "@/time/civil-date";
import { useNow } from "@/time/use-now";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { ConfirmButton } from "@/ui/confirm-button";

const FUTURE = "Choose today or an earlier date.";

const HEADING = (
  <AppText variant="heading" accessibilityRole="header">
    Sobriety
  </AppText>
);

const asLocalDate = (date: CivilDate) => new Date(date.year, date.month - 1, date.day);

// What VoiceOver and TalkBack say once a date is saved: the new count, and today's milestone if there is one.
function savedAnnouncement(start: CivilDate, today: CivilDate): string {
  const days = plural(soberTime(start, today)?.totalDays ?? 0, "day");
  const reached = milestoneToday(start, today);
  return `Sobriety date saved. ${days}.${reached === null ? "" : ` Today marks ${reached}.`}`;
}

// Spec §8: the counter. The date is kept only on the phone (spec §2), and the wording stays neutral: a new date is
// just a new date, never a "streak broken" or a "reset".
export function SobrietyCard() {
  const now = useNow();
  const today = civilDateOf(now);
  // undefined while the phone is reading it; "unreadable" when it couldn't.
  const [start, setStart] = useState<CivilDate | null | "unreadable">();
  // The day shown in the iPhone's open date wheels, or null when they're closed.
  const [picking, setPicking] = useState<Date | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Read each time the tab comes into view, so "Try again" after a failed read means coming back to it.
  useFocusEffect(
    useCallback(() => {
      readSobrietyDate().then(setStart, () => {
        setStart("unreadable");
      });
    }, []),
  );

  if (start === undefined) return null;
  if (start === "unreadable") {
    return (
      <View style={{ gap: 12 }}>
        {HEADING}
        <AppText accessibilityRole="alert">{GENERIC_FAILURE}</AppText>
      </View>
    );
  }

  const keep = (chosen: Date) => {
    const date = civilDateOf(chosen);
    if (soberTime(date, today) === null) {
      setProblem(FUTURE);
      return;
    }
    setPicking(null);
    saveSobrietyDate(date).then(
      () => {
        setStart(date);
        setProblem(null);
        AccessibilityInfo.announceForAccessibility(savedAnnouncement(date, today));
      },
      () => {
        setProblem(GENERIC_FAILURE);
      },
    );
  };
  const remove = () => {
    clearSobrietyDate().then(
      () => {
        setStart(null);
        setProblem(null);
      },
      () => {
        setProblem(GENERIC_FAILURE);
      },
    );
  };
  const openPicker = () => {
    setProblem(null);
    // A saved date after today (the phone's clock went back) opens on today, the latest day the picker offers.
    const value = start !== null && soberTime(start, today) !== null ? asLocalDate(start) : now;
    if (Platform.OS === "ios") {
      setPicking(value);
      return;
    }
    // Android's own dialog, opened once from the tap (the library's Android API): its OK keeps the day, and Cancel
    // keeps nothing. Rendering the picker component instead would reopen the dialog on every re-render of this card,
    // which the minute tick causes, snapping the dialog back to its first day.
    DateTimePickerAndroid.open({
      value,
      mode: "date",
      maximumDate: now,
      onValueChange: (_event, chosen) => {
        keep(chosen);
      },
    });
  };

  // iPhone shows the month, day and year wheels in the screen, all at once (the inline calendar hid its days behind
  // month and year wheels once its header was tapped, which confused going back years). Turning a wheel only chooses,
  // so "Save this date" keeps it.
  const picker = picking !== null && (
    <View style={{ gap: 8 }}>
      <DateTimePicker
        value={picking}
        mode="date"
        display="spinner"
        maximumDate={now}
        onValueChange={(_event, chosen) => {
          setPicking(chosen);
        }}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          label="Save this date"
          hint="Keeps the chosen date on this phone"
          onPress={() => {
            keep(picking);
          }}
        />
        <Button
          kind="secondary"
          label="Cancel"
          onPress={() => {
            setPicking(null);
            setProblem(null);
          }}
        />
      </View>
    </View>
  );
  const problemLine = problem !== null && <AppText accessibilityRole="alert">{problem}</AppText>;

  if (start === null) {
    return (
      <View style={{ gap: 12 }}>
        {HEADING}
        <AppText>
          Keep count of your sober time. The date is kept on this phone and never sent to our server.
        </AppText>
        {picker === false && (
          <Button
            label="Set my sobriety date"
            hint="Opens a calendar to choose the date"
            onPress={openPicker}
          />
        )}
        {picker}
        {problemLine}
      </View>
    );
  }

  const time = soberTime(start, today);
  const changeButtons = picker === false && (
    <View style={{ gap: 8 }}>
      <Button
        kind="secondary"
        label="Set a new date"
        hint="Opens a calendar to choose another date"
        onPress={openPicker}
      />
      <ConfirmButton
        label="Remove the date"
        hint="Asks before deleting the date from this phone"
        question="Remove your sobriety date from this phone? You can set it again any time."
        confirmLabel="Remove it"
        confirmHint="Deletes the date from this phone"
        cancelLabel="Keep it"
        onConfirm={remove}
      />
    </View>
  );
  if (time === null) {
    return (
      <View style={{ gap: 12 }}>
        {HEADING}
        <AppText>{`Your sobriety date is ${dateLabel(start)}, which is after today's date on this phone.`}</AppText>
        {changeButtons}
        {picker}
        {problemLine}
      </View>
    );
  }

  const reached = milestoneToday(start, today);
  const next = nextMilestone(start, today);
  return (
    <View style={{ gap: 12 }}>
      {HEADING}
      <AppText variant="title">{plural(time.totalDays, "day")}</AppText>
      {/* Under a month, the breakdown would only repeat the days. */}
      {(time.years > 0 || time.months > 0) && <AppText>{breakdownLabel(time)}</AppText>}
      <AppText tone="muted">{`Since ${dateLabel(start)}`}</AppText>
      {reached !== null && <AppText variant="label">{`Today marks ${reached}.`}</AppText>}
      <AppText tone="muted">{`Next: ${next.label} on ${dateLabel(next.date)}`}</AppText>
      {changeButtons}
      {picker}
      {problemLine}
    </View>
  );
}
