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
  createGameDataFeature,
  createItemStore,
  createWagoSource,
  foreverProduct,
  type GameDataSource,
  type ItemStore,
} from "@nozdormu/gamedata";
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
  readonly items: ItemStore;
  readonly gameData: GameDataSource;
  readonly logger: Pick<Logger, "info">;
}

export function createFeatureDeps(
  config: Config,
  db: Database,
  rest: REST,
  logger: Pick<Logger, "info">,
): FeatureDeps {
  return {
    config,
    logger,
    publish: createChannelPublisher(rest),
    recentPosts: createRecentPostReader(rest),
    seenVideos: createSeenVideoStore(db),
    readFeed: readFeedOverHttp,
    items: createItemStore(db),
    gameData: createWagoSource({ fetch, product: foreverProduct }),
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
    createGameDataFeature({ items: deps.items, source: deps.gameData, logger: deps.logger }),
  ];
}

export function scheduledJobs(features: readonly Feature[]): ScheduledJob[] {
  return features.flatMap((feature) => feature.jobs ?? []);
}
