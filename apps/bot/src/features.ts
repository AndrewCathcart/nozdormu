import {
  createBluePostsFeature,
  createForumReader,
  createSeenPostStore,
  type ForumReader,
  type SeenPostStore,
} from "@nozdormu/blueposts";
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
  createGameDataStore,
  createWagoSource,
  foreverProduct,
  type GameDataSource,
  type GameDataStore,
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

// The forum whose staff posts go in the Forever news channel, the feed name its seen posts are
// stored under, and the staff groups whose posts are read: its Blizzard tracker, and its developers,
// most of whom the tracker leaves out.
const euForums = {
  address: "https://eu.forums.blizzard.com/en/wow",
  feed: "eu-forums",
  groups: ["blizzard-tracker", "wow-developer"],
};

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
  readonly readStaffPosts: ForumReader;
  readonly seenStaffPosts: SeenPostStore;
  readonly logger: Pick<Logger, "info" | "warn">;
}

export function createFeatureDeps(
  config: Config,
  db: Database,
  rest: REST,
  logger: Pick<Logger, "info" | "warn">,
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
    readStaffPosts: createForumReader({ fetch, forum: euForums.address }),
    seenStaffPosts: createSeenPostStore(db),
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
    createBluePostsFeature({
      newsChannelId: deps.config.foreverNews.channelId,
      feed: euForums.feed,
      groups: euForums.groups,
      readPosts: deps.readStaffPosts,
      seenPosts: deps.seenStaffPosts,
      publish: deps.publish,
      recentPosts: deps.recentPosts,
      logger: deps.logger,
    }),
  ];
}

export function scheduledJobs(features: readonly Feature[]): ScheduledJob[] {
  return features.flatMap((feature) => feature.jobs ?? []);
}
