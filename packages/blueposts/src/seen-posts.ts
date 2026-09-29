import { bluePostFeeds, bluePosts, type Database } from "@nozdormu/db";
import { and, eq, inArray } from "drizzle-orm";

export interface SeenPost {
  readonly id: number;
  readonly createdAt: Date;
}

// What the news channel remembers about a staff-post feed.
export interface FeedHistory {
  readonly firstCheckDone: boolean;
  // The newest post's time at the first check, if it had any posts. An unseen post no newer than
  // this was already there (or has resurfaced after a newer one was deleted), so it isn't news.
  readonly baseline: Date | undefined;
}

// The staff posts each feed has seen: posted, or already there at the first check.
export interface SeenPostStore {
  readonly history: (feed: string) => Promise<FeedHistory>;
  // Marks the feed as checked and records the posts already on it, in one transaction.
  readonly recordFirstCheck: (feed: string, posts: readonly SeenPost[]) => Promise<void>;
  // Which of these posts the feed has seen.
  readonly seenIds: (feed: string, postIds: readonly number[]) => Promise<Set<number>>;
  readonly markSeen: (feed: string, postIds: readonly number[]) => Promise<void>;
}

type Executor = Pick<Database, "insert">;

async function insertPosts(db: Executor, feed: string, postIds: readonly number[]): Promise<void> {
  if (postIds.length === 0) {
    return;
  }
  await db
    .insert(bluePosts)
    .values(postIds.map((postId) => ({ feed, postId })))
    .onConflictDoNothing();
}

export function createSeenPostStore(db: Database): SeenPostStore {
  return {
    history: async (feed) => {
      const [row] = await db
        .select({ baseline: bluePostFeeds.baselineCreatedAt })
        .from(bluePostFeeds)
        .where(eq(bluePostFeeds.feed, feed));
      return { firstCheckDone: row !== undefined, baseline: row?.baseline ?? undefined };
    },
    recordFirstCheck: async (feed, posts) => {
      await db.transaction(async (tx) => {
        const times = posts.map((post) => post.createdAt.getTime());
        const baselineCreatedAt = times.length === 0 ? null : new Date(Math.max(...times));
        await tx.insert(bluePostFeeds).values({ feed, baselineCreatedAt }).onConflictDoNothing();
        await insertPosts(
          tx,
          feed,
          posts.map((post) => post.id),
        );
      });
    },
    seenIds: async (feed, postIds) => {
      if (postIds.length === 0) {
        return new Set();
      }
      const seen = await db
        .select({ postId: bluePosts.postId })
        .from(bluePosts)
        .where(and(eq(bluePosts.feed, feed), inArray(bluePosts.postId, [...postIds])));
      return new Set(seen.map((row) => row.postId));
    },
    markSeen: async (feed, postIds) => {
      await insertPosts(db, feed, postIds);
    },
  };
}
