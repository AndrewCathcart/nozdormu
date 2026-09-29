import { describe, expect, it } from "vitest";
import { foreverMilestones, remindersFor } from "./milestones.ts";

describe("Forever's milestones", () => {
  it("has launch at 3:00 p.m. PST on 4 November 2026, as Blizzard announced", () => {
    const launch = foreverMilestones.find((milestone) => milestone.key === "launch");

    expect(launch).toMatchObject({ kind: "time", at: new Date("2026-11-04T15:00:00-08:00") });
  });

  it("has the raids opening on 9 December 2026, a date without a time", () => {
    const raids = foreverMilestones.find((milestone) => milestone.key === "raids");

    expect(raids).toMatchObject({ kind: "day", on: new Date("2026-12-09T09:00:00+01:00") });
  });

  it("keeps every reminder's nonce within Discord's 25 characters", () => {
    const tooLong = foreverMilestones
      .flatMap(remindersFor)
      .map((reminder) => `cal-${reminder.key}`)
      .filter((nonce) => nonce.length > 25);

    expect(tooLong).toEqual([]);
  });
});
