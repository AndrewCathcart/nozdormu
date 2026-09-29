// In ISO order, so a day's index plus one is its Temporal dayOfWeek.
const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof weekdays)[number];

// A time of day on one day of the week, in an IANA time zone such as "Europe/London".
export interface WeeklyTime {
  readonly day: Weekday;
  readonly hour: number;
  readonly minute: number;
  readonly timeZone: string;
}

// A named zone such as "Europe/London". Temporal also accepts fixed offsets such as "+01:00", which
// never follow daylight saving.
function isTimeZone(name: string): boolean {
  if (name.startsWith("+") || name.startsWith("-")) {
    return false;
  }
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(name);
    return true;
  } catch {
    return false;
  }
}

function isWholeNumberUpTo(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

// Why the weekly time can't be used, or undefined if it can.
export function weeklyTimeProblem(time: WeeklyTime): string | undefined {
  if (!isTimeZone(time.timeZone)) {
    return `the time zone "${time.timeZone}" isn't an IANA time zone`;
  }
  if (!isWholeNumberUpTo(time.hour, 23) || !isWholeNumberUpTo(time.minute, 59)) {
    return `hour ${String(time.hour)}, minute ${String(time.minute)} isn't a time of day (the hour must be a whole number from 0 to 23, and the minute from 0 to 59)`;
  }
  return undefined;
}

// The weekly time on the given local date. A time the clocks skip (a daylight-saving gap) moves
// forward by the length of the gap.
function onLocalDate(time: WeeklyTime, date: Temporal.PlainDate): Temporal.ZonedDateTime {
  return date.toZonedDateTime({
    timeZone: time.timeZone,
    plainTime: new Temporal.PlainTime(time.hour, time.minute),
  });
}

function toDate(moment: Temporal.ZonedDateTime): Date {
  return new Date(moment.epochMilliseconds);
}

function latestZoned(time: WeeklyTime, at: Date): Temporal.ZonedDateTime {
  const local = Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(
    time.timeZone,
  );
  const daysSince = (local.dayOfWeek - (weekdays.indexOf(time.day) + 1) + 7) % 7;
  const thisWeek = onLocalDate(time, local.toPlainDate().subtract({ days: daysSince }));
  return Temporal.ZonedDateTime.compare(thisWeek, local) <= 0
    ? thisWeek
    : onLocalDate(time, thisWeek.toPlainDate().subtract({ weeks: 1 }));
}

// The most recent weekly time at or before `at`.
export function latestWeeklyTime(time: WeeklyTime, at: Date): Date {
  return toDate(latestZoned(time, at));
}

// The first weekly time after `after`. Counted in local dates rather than as 7 × 24 hours, so a
// week that gains or loses an hour to daylight saving still lands on the local time.
export function nextWeeklyTime(time: WeeklyTime, after: Date): Date {
  return toDate(onLocalDate(time, latestZoned(time, after).toPlainDate().add({ weeks: 1 })));
}
