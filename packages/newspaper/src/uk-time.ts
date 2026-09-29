// The guild's newspaper runs on UK time. Dates are spelled out here rather than with Intl, whose
// wording varies between ICU versions ("Sep" or "Sept").
export const newspaperTimeZone = "Europe/London";

const dayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function inUkTime(moment: Date): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(moment.getTime()).toZonedDateTimeISO(
    newspaperTimeZone,
  );
}

function names(local: Temporal.ZonedDateTime): { day: string; month: string } {
  return { day: dayNames[local.dayOfWeek - 1] ?? "", month: monthNames[local.month - 1] ?? "" };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

// For example "Mon 21 Sep 09:12".
export function shortDateTime(moment: Date): string {
  const local = inUkTime(moment);
  const { day, month } = names(local);
  return `${day.slice(0, 3)} ${String(local.day)} ${month.slice(0, 3)} ${twoDigits(local.hour)}:${twoDigits(local.minute)}`;
}

function spelledOut(local: Temporal.ZonedDateTime): string {
  const { day, month } = names(local);
  return `${day} ${String(local.day)} ${month} ${String(local.year)}`;
}

// For example "Monday 28 September 2026".
export function longDate(moment: Date): string {
  return spelledOut(inUkTime(moment));
}

// For example "Monday 21 September 2026 at 09:00".
export function longDateTime(moment: Date): string {
  const local = inUkTime(moment);
  return `${spelledOut(local)} at ${twoDigits(local.hour)}:${twoDigits(local.minute)}`;
}
