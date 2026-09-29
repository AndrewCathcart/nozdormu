import { z } from "zod";
import { htmlToText } from "./text.ts";

// A forum category, and the one it's under, if any.
export interface Forum {
  readonly name: string;
  readonly parent: string | undefined;
}

// A post by Blizzard staff, from a forum's staff-post tracker.
export interface StaffPost {
  readonly id: number;
  readonly createdAt: Date;
  // Their display name, or their username if they have none.
  readonly author: string;
  // Their title on the forum, such as "Community Manager", if they have one.
  readonly authorTitle: string | undefined;
  readonly avatarUrl: string | undefined;
  readonly topicTitle: string;
  readonly url: string;
  // "/<topic id>/<post number>", the end of the link, which stays the same if the topic is renamed.
  readonly linkEnd: string;
  // Whether it answers someone else's topic, rather than starting one.
  readonly isReply: boolean;
  // Undefined if the post's category isn't one the forum lists.
  readonly forum: Forum | undefined;
  // The post's opening, as plain text.
  readonly excerpt: string;
}

// Reads the latest posts by a staff group on the forum (such as "blizzard-tracker"), newest first.
export type ForumReader = (group: string) => Promise<StaffPost[]>;

export interface ForumReaderOptions {
  readonly fetch: typeof fetch;
  // The forum's address, such as "https://eu.forums.blizzard.com/en/wow".
  readonly forum: string;
}

const trackerPage = z.object({
  posts: z.array(
    z.object({
      id: z.int().positive(),
      created_at: z.iso.datetime(),
      topic_id: z.int().positive(),
      topic_title: z.string(),
      url: z.string(),
      category_id: z.number(),
      post_number: z.number(),
      username: z.string(),
      name: z.string().nullish(),
      user_title: z.string().nullish(),
      avatar_template: z.string().nullish(),
      excerpt: z.string(),
    }),
  ),
});

const site = z.object({
  categories: z.array(
    z.object({ id: z.number(), name: z.string(), parent_category_id: z.number().nullish() }),
  ),
});

// Pixels. Discord shows an embed's author icon small, so this is plenty even on sharp screens.
const avatarSize = 96;

interface Category {
  readonly name: string;
  readonly parentId: number | undefined;
}

// The forum is Blizzard's Discourse. Its tracker lists the latest staff posts, and its site
// description names the categories they're in. A page is small, so allow half a minute.
export function createForumReader(options: ForumReaderOptions): ForumReader {
  const get = async (path: string): Promise<unknown> => {
    const response = await options.fetch(`${options.forum}${path}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`The forum answered HTTP ${String(response.status)} for ${path}.`);
    }
    return response.json();
  };

  // The categories rarely change, so they're looked up again only when a post is in one that
  // isn't known yet.
  let categories = new Map<number, Category>();
  const categoriesFor = async (ids: readonly number[]): Promise<Map<number, Category>> => {
    if (ids.some((id) => !categories.has(id))) {
      categories = new Map(
        site
          .parse(await get("/site.json"))
          .categories.map((category) => [
            category.id,
            { name: category.name, parentId: category.parent_category_id ?? undefined },
          ]),
      );
    }
    return categories;
  };

  const forumOf = (known: ReadonlyMap<number, Category>, id: number): Forum | undefined => {
    const category = known.get(id);
    if (category === undefined) {
      return undefined;
    }
    const parent = category.parentId === undefined ? undefined : known.get(category.parentId);
    return { name: category.name, parent: parent?.name };
  };

  return async (group) => {
    const { posts } = trackerPage.parse(await get(`/groups/${group}/posts.json`));
    // A staff group's page always has posts. An empty one means something's wrong, and taking it
    // for a quiet forum would record an empty first check, then post a week of old posts.
    if (posts.length === 0) {
      throw new Error(`The forum listed no posts for ${group}.`);
    }
    const known = await categoriesFor(posts.map((post) => post.category_id));
    return posts.map((post) => ({
      id: post.id,
      createdAt: new Date(post.created_at),
      author:
        post.name === undefined || post.name === null || post.name === ""
          ? post.username
          : post.name,
      authorTitle: post.user_title === null || post.user_title === "" ? undefined : post.user_title,
      avatarUrl:
        post.avatar_template === undefined || post.avatar_template === null
          ? undefined
          : new URL(post.avatar_template.replace("{size}", String(avatarSize)), options.forum).href,
      topicTitle: post.topic_title,
      url: `${options.forum}${post.url}`,
      linkEnd: `/${String(post.topic_id)}/${String(post.post_number)}`,
      isReply: post.post_number > 1,
      forum: forumOf(known, post.category_id),
      excerpt: htmlToText(post.excerpt),
    }));
  };
}
