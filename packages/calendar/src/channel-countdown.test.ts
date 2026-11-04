import type { ChannelNamer, Logger, ScheduledJob } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import {
  type ChannelCountdown,
  type ChannelCountdownDeps,
  type ChannelCountdownStore,
  createChannelCountdownFeature,
} from "./channel-countdown.ts";
import type { Milestone } from "./milestones.ts";

// Made up.
const newsChannelId = "300000000000000007";
const usualName = "made-up-news";
const launchAt = new Date("2026-11-04T23:00:00Z");
const launch: Milestone = {
  key: "made-up-launch",
  kind: "time",
  at: launchAt,
  soon: "Made-up Game launches",
  arrived: "Made-up Game is live",
  channelCountdown: "⏳made-up-in",
};

function before(time: Date, hours: number, minutes: number): Date {
  return new Date(time.getTime() - (hours * 60 + minutes) * 60_000);
}

// An in-memory store of the channel's countdown.
function createFakeStore(initial?: ChannelCountdown) {
  const countdowns = new Map<string, ChannelCountdown>();
  if (initial !== undefined) {
    countdowns.set(newsChannelId, initial);
  }
  return {
    countdowns,
    countdownOf: vi.fn<ChannelCountdownStore["countdownOf"]>((channelId) =>
      Promise.resolve(countdowns.get(channelId)),
    ),
    start: vi.fn<ChannelCountdownStore["start"]>((channelId, originalName) => {
      if (!countdowns.has(channelId)) {
        countdowns.set(channelId, { originalName, shownName: undefined });
      }
      return Promise.resolve();
    }),
    markShown: vi.fn<ChannelCountdownStore["markShown"]>((channelId, shownName) => {
      const countdown = countdowns.get(channelId);
      if (countdown !== undefined) {
        countdowns.set(channelId, { ...countdown, shownName });
      }
      return Promise.resolve();
    }),
    finish: vi.fn<ChannelCountdownStore["finish"]>((channelId) => {
      countdowns.delete(channelId);
      return Promise.resolve();
    }),
  } satisfies ChannelCountdownStore & { readonly countdowns: Map<string, ChannelCountdown> };
}

function createDeps(now: Date, initial?: ChannelCountdown) {
  return {
    newsChannelId,
    milestones: [launch],
    now: vi.fn<() => Date>(() => now),
    countdowns: createFakeStore(initial),
    channelNames: {
      nameOf: vi.fn<ChannelNamer["nameOf"]>().mockResolvedValue(usualName),
      rename: vi.fn<ChannelNamer["rename"]>().mockResolvedValue(undefined),
    },
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  } satisfies ChannelCountdownDeps;
}

function countdownJob(deps: ChannelCountdownDeps): ScheduledJob {
  const [found] = createChannelCountdownFeature(deps).jobs ?? [];
  if (found === undefined) {
    throw new Error("The feature has no job.");
  }
  return found;
}

function newNames(deps: ReturnType<typeof createDeps>): string[] {
  return deps.channelNames.rename.mock.calls.map(([, name]) => name);
}

describe("channel name countdown", () => {
  it("renames the news channel to the time left, rounded up to 10 minutes", async () => {
    const deps = createDeps(before(launchAt, 22, 43));

    await countdownJob(deps).run();

    expect(newNames(deps)).toEqual(["⏳made-up-in-22h-50m"]);
  });

  it("renames only when the countdown moves on a step", async () => {
    const deps = createDeps(before(launchAt, 22, 43), {
      originalName: usualName,
      shownName: "⏳made-up-in-22h-50m",
    });

    await countdownJob(deps).run();

    expect(newNames(deps)).toEqual([]);
  });

  it("gives the channel its usual name back once the time arrives", async () => {
    const deps = createDeps(before(launchAt, 0, 5));
    const job = countdownJob(deps);
    await job.run();
    deps.channelNames.nameOf.mockResolvedValue("⏳made-up-in-10m");
    deps.now.mockReturnValue(new Date(launchAt.getTime() + 30_000));

    await job.run();

    expect(newNames(deps)).toEqual(["⏳made-up-in-10m", usualName]);
  });

  it("gives the usual name back only once", async () => {
    const deps = createDeps(new Date(launchAt.getTime() + 30_000), {
      originalName: usualName,
      shownName: "⏳made-up-in-10m",
    });
    const job = countdownJob(deps);
    await job.run();
    deps.now.mockReturnValue(new Date(launchAt.getTime() + 90_000));

    await job.run();

    expect(newNames(deps)).toEqual([usualName]);
  });

  it("tries giving the usual name back again after a failed rename", async () => {
    const deps = createDeps(new Date(launchAt.getTime() + 30_000), {
      originalName: usualName,
      shownName: "⏳made-up-in-10m",
    });
    deps.channelNames.rename.mockRejectedValueOnce(new Error("Discord is down"));
    const job = countdownJob(deps);
    await expect(job.run()).rejects.toThrow("Discord is down");

    await job.run();

    expect(newNames(deps)).toEqual([usualName, usualName]);
  });

  it("never mistakes its own countdown for the channel's usual name", async () => {
    const deps = createDeps(before(launchAt, 22, 43));
    deps.countdowns.markShown.mockRejectedValueOnce(new Error("Postgres is down"));
    const job = countdownJob(deps);
    await expect(job.run()).rejects.toThrow("Postgres is down");
    deps.channelNames.nameOf.mockResolvedValue("⏳made-up-in-22h-50m");
    await job.run();
    deps.now.mockReturnValue(new Date(launchAt.getTime() + 30_000));

    await job.run();

    expect(newNames(deps)).toEqual(["⏳made-up-in-22h-50m", "⏳made-up-in-22h-50m", usualName]);
  });

  it.each([
    [23, 0, "⏳made-up-in-23h"],
    [22, 55, "⏳made-up-in-23h"],
    [24, 0, "⏳made-up-in-24h"],
    [0, 41, "⏳made-up-in-50m"],
    [0, 1, "⏳made-up-in-10m"],
  ])("shows %ih %im left as %s", async (hours, minutes, name) => {
    const deps = createDeps(before(launchAt, hours, minutes));

    await countdownJob(deps).run();

    expect(newNames(deps)).toEqual([name]);
  });

  it("logs each rename by channel, never the channel's usual name", async () => {
    const deps = createDeps(before(launchAt, 0, 5));
    const job = countdownJob(deps);
    await job.run();
    deps.now.mockReturnValue(new Date(launchAt.getTime() + 30_000));

    await job.run();

    expect(deps.logger.info.mock.calls.map(([fields]) => fields)).toEqual([
      {
        event: "calendar.channel_renamed",
        channelId: newsChannelId,
        countdown: "⏳made-up-in-10m",
      },
      { event: "calendar.channel_restored", channelId: newsChannelId },
    ]);
  });

  it("leaves the channel alone until the last day", async () => {
    const deps = createDeps(before(launchAt, 24, 1));

    await countdownJob(deps).run();

    expect(newNames(deps)).toEqual([]);
  });
});
