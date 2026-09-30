import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { GENERIC_FAILURE } from "@/cache/use-cached-read";
import { breakdownLabel, milestoneToday, nextMilestone, plural, soberTime } from "@/sobriety/counter";
import { clearSobrietyDate, readSobrietyDate, saveSobrietyDate } from "@/sobriety/sobriety-date";
import { type CivilDate, civilDateOf, dateLabel } from "@/time/civil-date";
import { useNow } from "@/time/use-now";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";

const FUTURE = "Choose today or an earlier date.";

const HEADING = (
  <AppText variant="heading" accessibilityRole="header">
    Sobriety
  </AppText>
);

const asLocalDate = (date: CivilDate) => new Date(date.year, date.month - 1, date.day);

// Spec §8: the counter. The date is kept only on the phone (spec §2), and the wording stays neutral: a new date is
// just a new date, never a "streak broken" or a "reset".
export function SobrietyCard() {
  const now = useNow();
  const today = civilDateOf(now);
  // undefined while the phone is reading it; "unreadable" when it couldn't.
  const [start, setStart] = useState<CivilDate | null | "unreadable">();
  // The day shown in the open picker, or null when it's closed.
  const [picking, setPicking] = useState<Date | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    readSobrietyDate().then(setStart, () => {
      setStart("unreadable");
    });
  }, []);

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
    setPicking(start !== null && soberTime(start, today) !== null ? asLocalDate(start) : now);
  };

  // iPhone shows a calendar in the screen, where tapping a day only chooses it, so "Save this date" keeps it. Android
  // shows its own dialog, whose OK keeps the day and whose Cancel dismisses it.
  const ios = Platform.OS === "ios";
  const picker = picking !== null && (
    <View style={{ gap: 8 }}>
      <DateTimePicker
        value={picking}
        mode="date"
        display={ios ? "inline" : "default"}
        maximumDate={now}
        onValueChange={(_event, chosen) => {
          if (ios) {
            setPicking(chosen);
            return;
          }
          setPicking(null);
          keep(chosen);
        }}
        onDismiss={() => {
          setPicking(null);
        }}
      />
      {ios && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button
            label="Save this date"
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
      )}
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
        {picker === false && <Button label="Set my sobriety date" onPress={openPicker} />}
        {picker}
        {problemLine}
      </View>
    );
  }

  const time = soberTime(start, today);
  const changeButtons = picker === false && (
    <View style={{ gap: 8 }}>
      <Button kind="secondary" label="Set a new date" onPress={openPicker} />
      <Button kind="secondary" label="Remove the date" onPress={remove} />
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
