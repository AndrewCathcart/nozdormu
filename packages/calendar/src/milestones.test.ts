import { describe, expect, it } from "vitest";
import { foreverMilestones } from "./milestones.ts";

describe("Forever's milestones", () => {
  it("has launch at 3:00 p.m. PST on 4 November 2026, as Blizzard announced", () => {
    const launch = foreverMilestones.find((milestone) => milestone.key === "launch");

    expect(launch).toMatchObject({ kind: "time", at: new Date("2026-11-04T15:00:00-08:00") });
  });

  it("has the raids opening on 9 December 2026, posted about at 09:00 in Paris", () => {
    const raids = foreverMilestones.find((milestone) => milestone.key === "raids");

    expect(raids).toMatchObject({ kind: "day", morning: new Date("2026-12-09T09:00:00+01:00") });
  });
});
