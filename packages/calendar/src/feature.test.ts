import type { ChannelPublisher, Logger, ScheduledJob } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import { type CalendarFeatureDeps, createCalendarFeature } from "./feature.ts";
import { day, hour, type Milestone } from "./milestones.ts";
import type { PostedReminderStore } from "./posted-reminders.ts";

// Made up.
const newsChannelId = "300000000000000007";
const launchAt = new Date("2026-11-04T23:00:00Z");
const launch: Milestone = {
  key: "made-up-launch",
  kind: "time",
  at: launchAt,
  soon: "Made-up Game launches",
  arrived: "Made-up Game is live",
};
// 09:00 in Paris on the day.
const raidDay = new Date("2026-12-09T08:00:00Z");
const raids: Milestone = {
  key: "made-up-raids",
  kind: "day",
  on: raidDay,
  soon: "Made-up Raids open",
};

function at(time: Date, offsetMs: number): Date {
  return new Date(time.getTime() + offsetMs);
}

// An in-memory store of the reminders posted.
function createFakeStore(posted: readonly string[]) {
  const keys = new Set(posted);
  return {
    keys,
    postedKeys: vi.fn<PostedReminderStore["postedKeys"]>(() => Promise.resolve(new Set(keys))),
    markPosted: vi.fn<PostedReminderStore["markPosted"]>((key) => {
      keys.add(key);
      return Promise.resolve();
    }),
  } satisfies PostedReminderStore & { readonly keys: Set<string> };
}

function createDeps(now: Date, posted: readonly string[] = []) {
  return {
    newsChannelId,
    milestones: [launch, raids],
    now: vi.fn<() => Date>(() => now),
    posted: createFakeStore(posted),
    publish: vi.fn<ChannelPublisher>().mockResolvedValue(undefined),
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  } satisfies CalendarFeatureDeps;
}

function remindJob(deps: CalendarFeatureDeps): ScheduledJob {
  const [found] = createCalendarFeature(deps).jobs ?? [];
  if (found === undefined) {
    throw new Error("The feature has no job.");
  }
  return found;
}

function postedTexts(deps: ReturnType<typeof createDeps>): (string | undefined)[] {
  return deps.publish.mock.calls.map(([, message]) => message.content);
}

const launchSeconds = String(launchAt.getTime() / 1000);

describe("calendar reminders", () => {
  it("checks every 5 minutes", () => {
    expect(remindJob(createDeps(launchAt))).toMatchObject({
      name: "calendar.remind",
      intervalMs: 5 * 60_000,
    });
  });

  it("counts down to a date a week before, with a timestamp everyone sees in their own time", async () => {
    const deps = createDeps(at(launchAt, -7 * day));

    await remindJob(deps).run();

    expect(deps.publish).toHaveBeenCalledExactlyOnceWith(newsChannelId, {
      content: `⏳ **Made-up Game launches <t:${launchSeconds}:R>**, on <t:${launchSeconds}:F>.`,
      allowed_mentions: { parse: [] },
      nonce: "cal-made-up-launch-week",
      enforce_nonce: true,
    });
    expect(deps.posted.keys).toEqual(new Set(["made-up-launch-week"]));
  });

  it("counts down again a day before, after the week's post", async () => {
    const deps = createDeps(at(launchAt, -day), ["made-up-launch-week"]);

    await remindJob(deps).run();

    expect(postedTexts(deps)).toEqual([
      `⏳ **Made-up Game launches <t:${launchSeconds}:R>**, on <t:${launchSeconds}:F>.`,
    ]);
    expect(deps.posted.keys.has("made-up-launch-day")).toBe(true);
  });

  it("counts down again an hour before", async () => {
    const deps = createDeps(at(launchAt, -hour), ["made-up-launch-week", "made-up-launch-day"]);

    await remindJob(deps).run();

    expect(deps.posted.keys.has("made-up-launch-hour")).toBe(true);
  });

  it("posts nothing more than a week before", async () => {
    const deps = createDeps(at(launchAt, -7 * day - 1));

    await remindJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("posts each reminder once", async () => {
    const deps = createDeps(at(launchAt, -7 * day + hour), ["made-up-launch-week"]);

    await remindJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("posts only the latest reminder when the bot was down for earlier ones", async () => {
    // The week's reminder was due 6 days ago; the day's is due now.
    const deps = createDeps(at(launchAt, -day + 5 * 60_000));

    await remindJob(deps).run();

    expect(deps.posted.keys).toEqual(new Set(["made-up-launch-day"]));
  });

  it("posts nothing once a date is well past", async () => {
    const deps = createDeps(at(launchAt, 13 * hour));

    await remindJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("says when it's arrived, and when that was", async () => {
    const deps = createDeps(launchAt);

    await remindJob(deps).run();

    expect(postedTexts(deps)).toEqual([`🎉 **Made-up Game is live** <t:${launchSeconds}:R>.`]);
  });

  it("gives a date without a time a week's notice by its date alone, claiming no time", async () => {
    const deps = createDeps(at(raidDay, -7 * day));

    await remindJob(deps).run();

    expect(postedTexts(deps)).toEqual([
      "⏳ **Made-up Raids open on Wednesday 9 December.** The time hasn't been announced.",
    ]);
  });

  it("posts nothing on the day of a date without a time, since it may not be that day everywhere", async () => {
    const deps = createDeps(raidDay, ["made-up-raids-week"]);

    await remindJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("posts the others and fails the check when one post fails, trying it again next time", async () => {
    // Both milestones' reminders are due at once.
    const bothDue: Milestone = { ...launch, at: raidDay };
    const deps = { ...createDeps(at(raidDay, -7 * day)), milestones: [bothDue, raids] };
    deps.publish.mockRejectedValueOnce(new Error("Discord is down"));

    await expect(remindJob(deps).run()).rejects.toThrow("Couldn't post 1 calendar reminder(s).");
    expect(deps.posted.keys).toEqual(new Set(["made-up-raids-week"]));
  });
});
