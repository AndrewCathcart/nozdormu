import { type Database, youtubeChannels, youtubeVideos } from "@nozdormu/db";
import { eq } from "drizzle-orm";

export interface SeenVideo {
  readonly id: string;
  readonly publishedAt: Date;
}

// What the alert remembers about a YouTube channel.
export interface ChannelHistory {
  readonly firstCheckDone: boolean;
  readonly seenIds: ReadonlySet<string>;
  // The newest publish time in the feed at the first check, if it had any videos. An unseen video
  // no newer than this is an old one resurfacing, not a new upload.
  readonly baselinePublishedAt: Date | undefined;
}

export interface SeenVideoStore {
  readonly history: (youtubeChannelId: string) => Promise<ChannelHistory>;
  // Marks the channel as checked and records the videos already on it, in one transaction.
  readonly recordFirstCheck: (
    youtubeChannelId: string,
    videos: readonly SeenVideo[],
  ) => Promise<void>;
  readonly markSeen: (youtubeChannelId: string, videos: readonly SeenVideo[]) => Promise<void>;
}

type Executor = Pick<Database, "insert">;

async function insertVideos(
  db: Executor,
  youtubeChannelId: string,
  videos: readonly SeenVideo[],
): Promise<void> {
  if (videos.length === 0) {
    return;
  }
  await db
    .insert(youtubeVideos)
    .values(
      videos.map((video) => ({
        youtubeChannelId,
        videoId: video.id,
        publishedAt: video.publishedAt,
      })),
    )
    .onConflictDoNothing();
}

export function createSeenVideoStore(db: Database): SeenVideoStore {
  return {
    history: async (youtubeChannelId) => {
      const [channel] = await db
        .select({ baselinePublishedAt: youtubeChannels.baselinePublishedAt })
        .from(youtubeChannels)
        .where(eq(youtubeChannels.youtubeChannelId, youtubeChannelId));
      const videos = await db
        .select({ id: youtubeVideos.videoId })
        .from(youtubeVideos)
        .where(eq(youtubeVideos.youtubeChannelId, youtubeChannelId));
      return {
        firstCheckDone: channel !== undefined,
        seenIds: new Set(videos.map((video) => video.id)),
        baselinePublishedAt: channel?.baselinePublishedAt ?? undefined,
      };
    },
    recordFirstCheck: async (youtubeChannelId, videos) => {
      await db.transaction(async (tx) => {
        const times = videos.map((video) => video.publishedAt.getTime());
        const baselinePublishedAt = times.length === 0 ? null : new Date(Math.max(...times));
        await tx
          .insert(youtubeChannels)
          .values({ youtubeChannelId, baselinePublishedAt })
          .onConflictDoNothing();
        await insertVideos(tx, youtubeChannelId, videos);
      });
    },
    markSeen: async (youtubeChannelId, videos) => {
      await insertVideos(db, youtubeChannelId, videos);
    },
  };
}
