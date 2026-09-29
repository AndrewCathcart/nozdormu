import type { ChannelPublisher, Feature, Logger, RecentPostReader } from "@nozdormu/core";
import type { Video } from "./feed.ts";
import type { FeedReader } from "./feed-reader.ts";
import type { SeenVideoStore } from "./seen-videos.ts";

// The YouTube channel the alert watches.
const scotteJaye = { name: "ScotteJaye", youtubeChannelId: "UCyMNUoiD0vlmFtiriDtVI5Q" };

export interface YouTubeFeatureDeps {
  // The Discord channel new videos are posted in.
  readonly alertChannelId: string;
  readonly readFeed: FeedReader;
  readonly seenVideos: SeenVideoStore;
  readonly publish: ChannelPublisher;
  readonly recentPosts: RecentPostReader;
  readonly logger: Pick<Logger, "info">;
}

function feedUrl(youtubeChannelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${youtubeChannelId}`;
}

function byPublishTime(a: Video, b: Video): number {
  return a.publishedAt.getTime() - b.publishedAt.getTime();
}

// Checks ScotteJaye's feed and posts each new video once. A video is recorded only after its post
// succeeds, so a failed post is retried at the next check. Before posting, the bot looks for the
// link among its own recent messages, so a post that succeeded before a crash isn't repeated, and
// each post carries a nonce, so Discord drops a repeat of it sent within a few minutes.
export function createYouTubeFeature(deps: YouTubeFeatureDeps): Feature {
  const channelId = scotteJaye.youtubeChannelId;

  const poll = async (): Promise<void> => {
    const videos = await deps.readFeed(feedUrl(channelId));
    const history = await deps.seenVideos.history(channelId);
    if (!history.firstCheckDone) {
      await deps.seenVideos.recordFirstCheck(channelId, videos);
      deps.logger.info(
        { event: "youtube.first_check", channel: scotteJaye.name, videos: videos.length },
        "Recorded the channel's existing videos without posting them",
      );
      return;
    }

    const unseen = videos.filter((video) => !history.seenIds.has(video.id));
    // A video no newer than the first check's newest is an old one resurfacing (say, after a newer
    // one was deleted), not a new upload. Every later upload gets posted and recorded.
    const baseline = history.baselinePublishedAt;
    const older = unseen.filter((video) => baseline !== undefined && video.publishedAt <= baseline);
    if (older.length > 0) {
      await deps.seenVideos.markSeen(channelId, older);
      deps.logger.info(
        {
          event: "youtube.skipped_older",
          channel: scotteJaye.name,
          videoIds: older.map((v) => v.id),
        },
        "Skipped older videos that reappeared in the feed",
      );
    }
    const fresh = unseen.filter((video) => !older.includes(video)).toSorted(byPublishTime);
    if (fresh.length === 0) {
      return;
    }

    const alreadyPosted = await deps.recentPosts(deps.alertChannelId);
    const failures: unknown[] = [];
    for (const video of fresh) {
      if (alreadyPosted.some((post) => post.content.includes(video.url))) {
        await deps.seenVideos.markSeen(channelId, [video]);
        continue;
      }
      try {
        await deps.publish(deps.alertChannelId, {
          content: `🚨 NEW ${scotteJaye.name.toUpperCase()} VIDEO 🚨\n${video.url}`,
          allowed_mentions: { parse: [] },
          nonce: `yt-${video.id}`,
          enforce_nonce: true,
        });
      } catch (error) {
        failures.push(error);
        continue;
      }
      try {
        await deps.seenVideos.markSeen(channelId, [video]);
      } catch (error) {
        // Posted but not recorded: the next check should find the post among the bot's own.
        failures.push(error);
        continue;
      }
      deps.logger.info(
        { event: "youtube.posted", channel: scotteJaye.name, videoId: video.id },
        "Posted a new YouTube video",
      );
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Couldn't post or record ${String(failures.length)} new video(s).`,
      );
    }
  };

  return {
    jobs: [{ name: "youtube.poll", intervalMs: 10 * 60_000, run: poll }],
  };
}
