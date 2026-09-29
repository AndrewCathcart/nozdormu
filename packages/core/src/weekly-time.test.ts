import { describe, expect, it } from "vitest";
import { latestWeeklyTime, nextWeeklyTime, type WeeklyTime } from "./weekly-time.ts";

const mondayMorningInLondon = {
  day: "monday",
  hour: 9,
  minute: 0,
  timeZone: "Europe/London",
} satisfies WeeklyTime;

describe("latestWeeklyTime", () => {
  it("finds the most recent weekly time, in the time zone's local time", () => {
    // Tuesday 29 September 2026, during British Summer Time (UTC+1).
    const latest = latestWeeklyTime(mondayMorningInLondon, new Date("2026-09-29T12:00:00Z"));

    expect(latest).toEqual(new Date("2026-09-28T08:00:00Z"));
  });

  it("counts a weekly time that is exactly now", () => {
    const latest = latestWeeklyTime(mondayMorningInLondon, new Date("2026-09-28T08:00:00Z"));

    expect(latest).toEqual(new Date("2026-09-28T08:00:00Z"));
  });

  it("finds the local time after the clocks go back", () => {
    // Tuesday 27 October 2026, two days after British Summer Time ended.
    const latest = latestWeeklyTime(mondayMorningInLondon, new Date("2026-10-27T12:00:00Z"));

    expect(latest).toEqual(new Date("2026-10-26T09:00:00Z"));
  });
});

describe("nextWeeklyTime", () => {
  it("finds the first weekly time after the given moment", () => {
    const next = nextWeeklyTime(mondayMorningInLondon, new Date("2026-09-29T12:00:00Z"));

    expect(next).toEqual(new Date("2026-10-05T08:00:00Z"));
  });

  // The clocks go back on Sunday 25 October 2026 and forward on Sunday 28 March 2027.
  it.each([
    ["back", "2026-10-19T08:00:00Z", "2026-10-26T09:00:00Z"],
    ["forward", "2027-03-22T09:00:00Z", "2027-03-29T08:00:00Z"],
  ])("keeps to the local time in a week when the clocks go %s", (_direction, after, expected) => {
    const next = nextWeeklyTime(mondayMorningInLondon, new Date(after));

    expect(next).toEqual(new Date(expected));
  });
});
