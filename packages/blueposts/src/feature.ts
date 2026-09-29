import type { ChannelPublisher, Feature, Logger, RecentPostReader } from "@nozdormu/core";
import { formatStaffPost } from "./format.ts";
import type { ForumReader, StaffPost } from "./forum.ts";
import type { SeenPostStore } from "./seen-posts.ts";

export interface BluePostsFeatureDeps {
  // The channel Forever news is posted in.
  readonly newsChannelId: string;
  // Names the forum the posts are read from, so each forum's seen posts are kept apart.
  readonly feed: string;
  readonly readPosts: ForumReader;
  readonly seenPosts: SeenPostStore;
  readonly publish: ChannelPublisher;
  readonly recentPosts: RecentPostReader;
  readonly logger: Pick<Logger, "info" | "warn">;
}

const forever = /forever/i;

// In one of the forums' Forever categories (or one under them), or a topic about Forever elsewhere,
// like Blizzard's news announcements in General Discussion.
function isAboutForever(post: StaffPost): boolean {
  return [post.forum?.name, post.forum?.parent, post.topicTitle].some(
    (text) => text !== undefined && forever.test(text),
  );
}

function byCreationTime(a: StaffPost, b: StaffPost): number {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

// Posts each new Blizzard staff forum post about Forever in the news channel. The first check
// records what's already there without posting it. A post is recorded only after it's posted, so a
// failed one is tried again at the next check; before posting, the bot looks for the post's link
// among its own recent messages, so one posted just before a crash isn't repeated.
export function createBluePostsFeature(deps: BluePostsFeatureDeps): Feature {
  const { feed } = deps;

  const poll = async (): Promise<void> => {
    const posts = await deps.readPosts();
    const history = await deps.seenPosts.history(feed);
    if (!history.firstCheckDone) {
      await deps.seenPosts.recordFirstCheck(feed, posts);
      deps.logger.info(
        { event: "blueposts.first_check", feed, posts: posts.length },
        "Recorded the staff posts already on the forum without posting them",
      );
      return;
    }
    const seen = await deps.seenPosts.seenIds(
      feed,
      posts.map((post) => post.id),
    );
    // The tracker shows only the latest posts. If none of them was seen before, more arrived since
    // the last check than it shows, perhaps while the bot was down.
    if (posts.length > 0 && seen.size === 0) {
      deps.logger.warn(
        { event: "blueposts.gap", feed, posts: posts.length },
        "Saw none of the tracker's posts before, so some may have been missed",
      );
    }
    const unseen = posts.filter((post) => !seen.has(post.id));
    // A post no newer than the first check's newest was already there, and has resurfaced (say,
    // after a newer post was deleted). Every later post gets posted and recorded, so it isn't new.
    const { baseline } = history;
    const isNew = (post: StaffPost): boolean => baseline === undefined || post.createdAt > baseline;
    const fresh = unseen
      .filter((post) => isAboutForever(post) && isNew(post))
      .toSorted(byCreationTime);
    // The rest are recorded without posting, so the next check knows it saw them.
    const skipped = unseen.filter((post) => !fresh.includes(post));
    if (skipped.length > 0) {
      await deps.seenPosts.markSeen(
        feed,
        skipped.map((post) => post.id),
      );
    }
    const older = skipped.filter(isAboutForever);
    if (older.length > 0) {
      deps.logger.info(
        { event: "blueposts.skipped_older", feed, postIds: older.map((post) => post.id) },
        "Skipped older staff posts that reappeared on the tracker",
      );
    }
    if (fresh.length === 0) {
      return;
    }

    const alreadyPosted = await deps.recentPosts(deps.newsChannelId);
    const failures: unknown[] = [];
    for (const post of fresh) {
      // The link's end still matches after the topic is renamed.
      const wasPosted = alreadyPosted.some((earlier) =>
        earlier.embedUrls.some((url) => url.endsWith(post.linkEnd)),
      );
      try {
        if (!wasPosted) {
          await deps.publish(deps.newsChannelId, formatStaffPost(post));
        }
        // Posted but not recorded: the next check should find the post among the bot's own.
        await deps.seenPosts.markSeen(feed, [post.id]);
      } catch (error) {
        failures.push(error);
        continue;
      }
      if (!wasPosted) {
        deps.logger.info(
          { event: "blueposts.posted", postId: post.id },
          "Posted a Blizzard staff post",
        );
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Couldn't post or record ${String(failures.length)} staff post(s).`,
      );
    }
  };

  return { jobs: [{ name: "blueposts.poll", intervalMs: 10 * 60_000, run: poll }] };
}
