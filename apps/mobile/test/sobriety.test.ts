import { appDatabase } from "@/db/database";
import { breakdownLabel, milestoneToday, nextMilestone, soberTime } from "@/sobriety/counter";
import { clearSobrietyDate, readSobrietyDate, saveSobrietyDate } from "@/sobriety/sobriety-date";
import type * as SobrietyDateModule from "@/sobriety/sobriety-date";
import { civilDateOf, dateLabel, daysBetween } from "@/time/civil-date";

import { resetAppData } from "./app-data";
import { relaunch } from "./native/expo-sqlite";

const date = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
};

describe("soberTime", () => {
  it.each([
    ["2025-10-05", "2025-10-05", { totalDays: 0, years: 0, months: 0, days: 0 }],
    ["2025-10-05", "2025-10-06", { totalDays: 1, years: 0, months: 0, days: 1 }],
    ["2025-10-05", "2026-10-04", { totalDays: 364, years: 0, months: 11, days: 29 }],
    ["2025-10-05", "2026-10-05", { totalDays: 365, years: 1, months: 0, days: 0 }],
    ["2025-10-05", "2026-11-21", { totalDays: 412, years: 1, months: 1, days: 16 }],
    // Across the spring-forward and fall-back nights (23- and 25-hour days on a US phone).
    ["2026-03-07", "2026-03-09", { totalDays: 2, years: 0, months: 0, days: 2 }],
    ["2026-10-31", "2026-11-02", { totalDays: 2, years: 0, months: 0, days: 2 }],
    // Month ends: a month from Jan 31 is the last day of February.
    ["2024-01-31", "2024-02-29", { totalDays: 29, years: 0, months: 1, days: 0 }],
    ["2025-01-31", "2025-02-28", { totalDays: 28, years: 0, months: 1, days: 0 }],
    ["2025-01-31", "2025-03-30", { totalDays: 58, years: 0, months: 1, days: 30 }],
    ["2025-01-31", "2025-03-31", { totalDays: 59, years: 0, months: 2, days: 0 }],
    // A leap-day start: its year is Feb 28 in other years, and Feb 29 again in leap years.
    ["2020-02-29", "2021-02-28", { totalDays: 365, years: 1, months: 0, days: 0 }],
    ["2020-02-29", "2021-03-01", { totalDays: 366, years: 1, months: 0, days: 1 }],
    ["2020-02-29", "2024-02-28", { totalDays: 1460, years: 3, months: 11, days: 30 }],
    ["2020-02-29", "2024-02-29", { totalDays: 1461, years: 4, months: 0, days: 0 }],
    // A year across a Feb 29 has 366 days.
    ["2023-03-01", "2024-03-01", { totalDays: 366, years: 1, months: 0, days: 0 }],
    ["2011-04-17", "2026-10-05", { totalDays: 5650, years: 15, months: 5, days: 18 }],
  ])("from %s to %s is %j", (start, today, expected) => {
    expect(soberTime(date(start), date(today))).toEqual(expected);
  });

  it("has nothing to count for a date in the future", () => {
    expect(soberTime(date("2026-10-06"), date("2026-10-05"))).toBeNull();
    expect(soberTime(date("2027-01-01"), date("2026-12-31"))).toBeNull();
  });

  it("reads the breakdown without zero parts", () => {
    expect(breakdownLabel({ totalDays: 412, years: 1, months: 1, days: 16 })).toBe(
      "1 year, 1 month, 16 days",
    );
    expect(breakdownLabel({ totalDays: 365, years: 1, months: 0, days: 0 })).toBe("1 year");
    expect(breakdownLabel({ totalDays: 64, years: 0, months: 2, days: 3 })).toBe("2 months, 3 days");
    expect(breakdownLabel({ totalDays: 761, years: 2, months: 0, days: 1 })).toBe("2 years, 1 day");
  });
});

describe("milestones", () => {
  it.each([
    ["2025-10-05", null],
    ["2025-10-06", "24 hours"],
    ["2025-10-07", null],
    ["2025-11-03", null],
    ["2025-11-04", "30 days"],
    ["2025-12-04", "60 days"],
    ["2026-01-03", "90 days"],
    ["2026-04-05", "6 months"],
    ["2026-07-05", "9 months"],
    ["2026-10-04", null],
    ["2026-10-05", "1 year"],
    ["2026-10-06", null],
    ["2027-10-05", "2 years"],
    ["2045-10-05", "20 years"],
  ])("started 2025-10-05, %s is %s", (today, label) => {
    expect(milestoneToday(date("2025-10-05"), date(today))).toBe(label);
  });

  it.each([
    ["2021-02-28", "1 year"],
    ["2021-03-01", null],
    ["2024-02-28", null],
    ["2024-02-29", "4 years"],
  ])("started on a leap day, %s is %s", (today, label) => {
    expect(milestoneToday(date("2020-02-29"), date(today))).toBe(label);
  });

  it.each([
    ["2025-08-31", "2026-02-28", "6 months"],
    ["2025-05-31", "2026-02-28", "9 months"],
    ["2025-03-31", "2025-09-30", "6 months"],
  ])("started %s, a month-end start's %s is %s", (start, today, label) => {
    expect(milestoneToday(date(start), date(today))).toBe(label);
  });

  it.each([
    ["2025-10-05", { label: "24 hours", date: date("2025-10-06") }],
    ["2025-10-06", { label: "30 days", date: date("2025-11-04") }],
    ["2026-01-03", { label: "6 months", date: date("2026-04-05") }],
    ["2026-07-05", { label: "1 year", date: date("2026-10-05") }],
    ["2026-10-05", { label: "2 years", date: date("2027-10-05") }],
    ["2030-12-31", { label: "6 years", date: date("2031-10-05") }],
  ])("started 2025-10-05, on %s the next is %j", (today, next) => {
    expect(nextMilestone(date("2025-10-05"), date(today))).toEqual(next);
  });

  it("puts a leap-day start's next year on Feb 28 when there's no Feb 29", () => {
    expect(nextMilestone(date("2020-02-29"), date("2022-03-01"))).toEqual({
      label: "3 years",
      date: date("2023-02-28"),
    });
  });
});

describe("civilDateOf", () => {
  // The tests run on a phone in America/Chicago (package.json).
  it("is the phone's own calendar date, not the UTC one", () => {
    expect(civilDateOf(new Date("2026-10-06T04:30:00Z"))).toEqual(date("2026-10-05"));
    expect(civilDateOf(new Date("2026-10-06T05:00:00Z"))).toEqual(date("2026-10-06"));
  });
});

describe("daysBetween", () => {
  it.each([
    ["2026-10-05", "2026-10-05", 0],
    ["2026-10-05", "2026-10-06", 1],
    ["2026-10-06", "2026-10-05", -1],
    // A 23-hour and a 25-hour day each count once.
    ["2026-03-07", "2026-03-09", 2],
    ["2026-10-31", "2026-11-02", 2],
    ["2024-02-28", "2024-03-01", 2],
    ["2025-12-31", "2026-01-01", 1],
  ])("from %s to %s is %d", (from, to, days) => {
    expect(daysBetween(date(from), date(to))).toBe(days);
  });
});

describe("dateLabel", () => {
  it("reads as the month's short name, the day and the year", () => {
    expect(dateLabel(date("2027-10-05"))).toBe("Oct 5, 2027");
    expect(dateLabel(date("2026-01-31"))).toBe("Jan 31, 2026");
    expect(dateLabel(date("2026-12-01"))).toBe("Dec 1, 2026");
  });
});

describe("the sobriety date on the phone", () => {
  beforeEach(resetAppData);

  it("is kept, replaced by a new date, and removed", async () => {
    expect(await readSobrietyDate()).toBeNull();
    await saveSobrietyDate(date("2025-10-05"));
    expect(await readSobrietyDate()).toEqual(date("2025-10-05"));
    await saveSobrietyDate(date("2011-04-17"));
    expect(await readSobrietyDate()).toEqual(date("2011-04-17"));
    await clearSobrietyDate();
    expect(await readSobrietyDate()).toBeNull();
  });

  it("is still there when the app is opened again", async () => {
    await saveSobrietyDate(date("2020-02-29"));
    let read: unknown;
    // A relaunch: a reopened connection and fresh modules (so nothing held in memory survives), the same database file.
    relaunch();
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModulesAsync needs a synchronous require.
      const relaunched = require("@/sobriety/sobriety-date") as typeof SobrietyDateModule;
      read = await relaunched.readSobrietyDate();
    });
    expect(read).toEqual(date("2020-02-29"));
  });

  it("is stored as a plain calendar date, with no time or zone", async () => {
    await saveSobrietyDate(date("2025-03-07"));
    const db = await appDatabase();
    expect(await db.getAllAsync("select key, value from settings", [])).toEqual([
      { key: "sobriety_date", value: "2025-03-07" },
    ]);
  });
});
