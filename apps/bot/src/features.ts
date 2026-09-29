import Anthropic from "@anthropic-ai/sdk";
import {
  type ChannelPublisher,
  createChannelPublisher,
  createRecentPostReader,
  type Feature,
  type Logger,
  type RecentPostReader,
  type ScheduledJob,
} from "@nozdormu/core";
import type { Database } from "@nozdormu/db";
import {
  createDungeonFeature,
  createDungeonStore,
  createSpyglassReader,
  type DungeonStore,
  type SpyglassReader,
} from "@nozdormu/dungeons";
import {
  createGameDataFeature,
  createGameDataStore,
  createWagoSource,
  foreverProduct,
  type GameDataSource,
  type GameDataStore,
} from "@nozdormu/gamedata";
import {
  type ChatReader,
  createClaudeWriter,
  createDigestFeature,
  createDiscordChatReader,
  createOpenAiIllustrator,
  type DigestWriter,
  type Illustrator,
} from "@nozdormu/digest";
import { createPingFeature } from "@nozdormu/ping";
import {
  createSeenVideoStore,
  createYouTubeFeature,
  type FeedReader,
  readFeedOverHttp,
  type SeenVideoStore,
} from "@nozdormu/youtube";
import type { REST } from "discord.js";
import type { Config } from "./config.ts";

// What the features need from the outside world. The bot passes the real ones; `pnpm job
// --dry-run` swaps in versions that print instead of posting or writing.
export interface FeatureDeps {
  readonly config: Config;
  readonly publish: ChannelPublisher;
  readonly recentPosts: RecentPostReader;
  readonly seenVideos: SeenVideoStore;
  readonly readFeed: FeedReader;
  readonly gameDataStore: GameDataStore;
  readonly gameDataSource: GameDataSource;
  readonly readChat: ChatReader;
  readonly writeDigest: DigestWriter;
  readonly drawIllustration: Illustrator;
  readonly now: () => Date;
  readonly logger: Pick<Logger, "info" | "error">;
  readonly readSpyglass: SpyglassReader;
  readonly dungeonStore: DungeonStore;
}

export function createFeatureDeps(
  config: Config,
  db: Database,
  rest: REST,
  logger: Pick<Logger, "info" | "error">,
): FeatureDeps {
  return {
    config,
    logger,
    publish: createChannelPublisher(rest),
    recentPosts: createRecentPostReader(rest),
    seenVideos: createSeenVideoStore(db),
    readFeed: readFeedOverHttp,
    gameDataStore: createGameDataStore(db),
    gameDataSource: createWagoSource({ fetch, product: foreverProduct }),
    readChat: createDiscordChatReader({ rest, guildId: config.discord.guildId, logger }),
    writeDigest: createClaudeWriter({
      client: new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 4 }),
      logger,
    }),
    drawIllustration: createOpenAiIllustrator({ fetch, apiKey: config.openai.apiKey, logger }),
    now: () => new Date(),
    readSpyglass: createSpyglassReader({ fetch }),
    dungeonStore: createDungeonStore(db),
  };
}

// Every feature the bot runs.
export function createFeatures(deps: FeatureDeps): Feature[] {
  return [
    createPingFeature(),
    createYouTubeFeature({
      alertChannelId: deps.config.youtube.alertChannelId,
      readFeed: deps.readFeed,
      seenVideos: deps.seenVideos,
      publish: deps.publish,
      recentPosts: deps.recentPosts,
      logger: deps.logger,
    }),
    createGameDataFeature({
      store: deps.gameDataStore,
      source: deps.gameDataSource,
      logger: deps.logger,
    }),
    createDigestFeature({
      channelIds: deps.config.digest.channelIds,
      postChannelId: deps.config.digest.postChannelId,
      readChat: deps.readChat,
      write: deps.writeDigest,
      draw: deps.drawIllustration,
      publish: deps.publish,
      now: deps.now,
      logger: deps.logger,
    }),
    createDungeonFeature({
      readSpyglass: deps.readSpyglass,
      store: deps.dungeonStore,
      logger: deps.logger,
    }),
  ];
}

export function scheduledJobs(features: readonly Feature[]): ScheduledJob[] {
  return features.flatMap((feature) => feature.jobs ?? []);
}
