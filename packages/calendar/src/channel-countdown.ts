import type { ChannelNamer, Feature, Logger } from "@nozdormu/core";
import { day, type Milestone } from "./milestones.ts";

// A channel counting down: the name it had before, and the countdown name it was last given.
export interface ChannelCountdown {
  readonly originalName: string;
  readonly shownName: string | undefined;
}

export interface ChannelCountdownStore {
  readonly countdownOf: (channelId: string) => Promise<ChannelCountdown | undefined>;
  // Keeps the first name stored, so a second start can't store a countdown name as the original.
  readonly start: (channelId: string, originalName: string) => Promise<void>;
  readonly markShown: (channelId: string, shownName: string) => Promise<void>;
  readonly finish: (channelId: string) => Promise<void>;
}

export interface ChannelCountdownDeps {
  readonly newsChannelId: string;
  readonly milestones: readonly Milestone[];
  readonly now: () => Date;
  readonly countdowns: ChannelCountdownStore;
  readonly channelNames: ChannelNamer;
  readonly logger: Pick<Logger, "info">;
}

// Discord allows 2 renames per channel every 10 minutes, so the name moves in 10-minute steps.
const stepMs = 10 * 60_000;
// The channel counts down for the last day.
const countdownMs = day;
// What the server's audit log says each rename was for.
const auditReason = "Calendar countdown";

// "22h-50m", "23h" or "50m": the time left, rounded up to the next step, so it never claims less
// time than there is.
function timeLeft(ms: number): string {
  const minutes = (Math.ceil(ms / stepMs) * stepMs) / 60_000;
  const hours = Math.floor(minutes / 60);
  const parts = [
    hours > 0 ? `${String(hours)}h` : "",
    minutes % 60 > 0 ? `${String(minutes % 60)}m` : "",
  ];
  return parts.filter((part) => part !== "").join("-");
}

// The name the channel should have now: a countdown during the last day before a milestone that
// has one, or none.
function countdownName(milestones: readonly Milestone[], now: Date): string | undefined {
  for (const milestone of milestones) {
    if (milestone.kind !== "time" || milestone.channelCountdown === undefined) {
      continue;
    }
    const left = milestone.at.getTime() - now.getTime();
    if (left > 0 && left <= countdownMs) {
      return `${milestone.channelCountdown}-${timeLeft(left)}`;
    }
  }
  return undefined;
}

export function createChannelCountdownFeature(deps: ChannelCountdownDeps): Feature {
  const channelId = deps.newsChannelId;
  const updateName = async (): Promise<void> => {
    const name = countdownName(deps.milestones, deps.now());
    const countdown = await deps.countdowns.countdownOf(channelId);
    if (name === undefined) {
      if (countdown !== undefined) {
        await deps.channelNames.rename(channelId, countdown.originalName, auditReason);
        await deps.countdowns.finish(channelId);
        deps.logger.info(
          { event: "calendar.channel_restored", channelId },
          "Gave the channel its usual name back",
        );
      }
      return;
    }
    if (countdown?.shownName === name) {
      return;
    }
    if (countdown === undefined) {
      await deps.countdowns.start(channelId, await deps.channelNames.nameOf(channelId));
    }
    await deps.channelNames.rename(channelId, name, auditReason);
    await deps.countdowns.markShown(channelId, name);
    deps.logger.info(
      { event: "calendar.channel_renamed", channelId, countdown: name },
      "Renamed the channel to count down",
    );
  };
  return { jobs: [{ name: "calendar.rename_channel", intervalMs: 60_000, run: updateName }] };
}
