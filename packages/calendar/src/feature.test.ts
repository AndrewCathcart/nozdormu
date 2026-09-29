import type {
  ChannelPublisher,
  Logger,
  RecentPost,
  RecentPostReader,
  ScheduledJob,
} from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import { type CalendarFeatureDeps, createCalendarFeature } from "./feature.ts";
import type { Milestone } from "./milestones.ts";
import type { PostedReminderStore } from "./posted-reminders.ts";
import type { ScheduledEvents } from "./scheduled-events.ts";

// Made up.
const newsChannelId = "300000000000000007";
const launchAt = new Date("2026-11-04T23:00:00Z");
const launch: Milestone = {
  key: "made-up-launch",
  kind: "time",
  at: launchAt,
  soon: "Made-up Game launches",
  arrived: "Made-up Game is live",
  event: { name: "Made-up Launch Night", description: "Made-up Game goes live.", hours: 3 },
};
// 09:00 in Paris on the day.
const raidMorning = new Date("2026-12-09T08:00:00Z");
const raids: Milestone = {
  key: "made-up-raids",
  kind: "day",
  morning: raidMorning,
  soon: "Made-up Raids open",
  arrived: "Made-up Raids open today",
};

const hour = 60 * 60_000;
const day = 24 * hour;

function at(time: Date, offsetMs: number): Date {
  return new Date(time.getTime() + offsetMs);
}

// An in-memory store of the reminders posted.
function createFakeStore(posted: readonly string[] = []) {
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

function createDeps(now: Date, posted: readonly string[] = [], eventNames: readonly string[] = []) {
  return {
    newsChannelId,
    events: {
      names: vi.fn<ScheduledEvents["names"]>(() => Promise.resolve(new Set(eventNames))),
      create: vi.fn<ScheduledEvents["create"]>().mockResolvedValue(undefined),
    } satisfies ScheduledEvents,
    milestones: [launch, raids],
    now: vi.fn<() => Date>(() => now),
    posted: createFakeStore(posted),
    publish: vi.fn<ChannelPublisher>().mockResolvedValue(undefined),
    recentPosts: vi.fn<RecentPostReader>().mockResolvedValue([]),
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  } satisfies CalendarFeatureDeps;
}

function remindJob(deps: CalendarFeatureDeps): ScheduledJob {
  const job = createCalendarFeature(deps).jobs?.find(
    (candidate) => candidate.name === "calendar.remind",
  );
  if (job === undefined) {
    throw new Error("The feature has no reminder job.");
  }
  return job;
}

function eventsJob(deps: CalendarFeatureDeps): ScheduledJob {
  const job = createCalendarFeature(deps).jobs?.find(
    (candidate) => candidate.name === "calendar.events",
  );
  if (job === undefined) {
    throw new Error("The feature has no events job.");
  }
  return job;
}

function postedTexts(deps: ReturnType<typeof createDeps>): (string | undefined)[] {
  return deps.publish.mock.calls.map(([, message]) => message.content);
}

const launchSeconds = String(launchAt.getTime() / 1000);
const raidSeconds = String(raidMorning.getTime() / 1000);

describe("calendar reminders", () => {
  it("checks every 5 minutes", () => {
    expect(remindJob(createDeps(launchAt))).toMatchObject({ intervalMs: 5 * 60_000 });
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

  it("says when it's arrived", async () => {
    const deps = createDeps(launchAt);

    await remindJob(deps).run();

    expect(postedTexts(deps)).toEqual(["🎉 **Made-up Game is live.**"]);
  });

  it("counts down to a date without a time by the day alone", async () => {
    const deps = createDeps(at(raidMorning, -7 * day));

    await remindJob(deps).run();

    expect(postedTexts(deps)).toEqual([
      `⏳ **Made-up Raids open <t:${raidSeconds}:R>**, on <t:${raidSeconds}:D>.`,
    ]);
  });

  it("says on the morning that a date without a time is today", async () => {
    const deps = createDeps(raidMorning);

    await remindJob(deps).run();

    expect(postedTexts(deps)).toEqual([
      "🗓️ **Made-up Raids open today.** The time hasn't been announced.",
    ]);
  });

  it("records a reminder it already posted without posting it again", async () => {
    const deps = createDeps(launchAt);
    deps.recentPosts.mockResolvedValue([
      { content: "🎉 **Made-up Game is live.**", embedUrls: [] } satisfies RecentPost,
    ]);

    await remindJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.posted.keys).toEqual(new Set(["made-up-launch-now"]));
  });
});

describe("calendar Discord Events", () => {
  it("checks every 6 hours", () => {
    expect(eventsJob(createDeps(launchAt))).toMatchObject({ intervalMs: 6 * hour });
  });

  it("creates an Event for a coming date with a time, and none for a date without one", async () => {
    const deps = createDeps(at(launchAt, -30 * day));

    await eventsJob(deps).run();

    expect(deps.events.create).toHaveBeenCalledExactlyOnceWith({
      name: "Made-up Launch Night",
      description: "Made-up Game goes live.",
      startsAt: launchAt,
      endsAt: at(launchAt, 3 * hour),
    });
  });

  it("leaves an Event the server already has", async () => {
    const deps = createDeps(at(launchAt, -30 * day), [], ["Made-up Launch Night"]);

    await eventsJob(deps).run();

    expect(deps.events.create).not.toHaveBeenCalled();
  });

  it("creates no Event for a date that's passed", async () => {
    const deps = createDeps(at(launchAt, hour));

    await eventsJob(deps).run();

    expect(deps.events.create).not.toHaveBeenCalled();
  });
});
