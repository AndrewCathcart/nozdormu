import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createForumReader } from "./forum.ts";

const forum = "https://eu.forums.example/en/wow";
// The staff group whose posts are read.
const group = "made-up-staff";

// The fields the reader uses from a post in the forum's staff-post tracker.
interface TrackerPost {
  readonly id: number;
  readonly created_at: string;
  readonly topic_id: number;
  readonly topic_title: string;
  readonly url: string;
  readonly category_id: number;
  readonly post_number: number;
  readonly username: string;
  readonly name: string | null;
  readonly user_title: string | null;
  readonly avatar_template: string | null;
  readonly excerpt: string;
}

interface SiteCategory {
  readonly id: number;
  readonly name: string;
  readonly parent_category_id?: number | null;
}

// A made-up forum: Forever (40) with General Discussion (41) under it, News (7), and Realms (8),
// whose missing parent is given as null.
const categories: SiteCategory[] = [
  { id: 40, name: "WoW: Forever" },
  { id: 41, name: "WoW: Forever General Discussion", parent_category_id: 40 },
  { id: 7, name: "News" },
  { id: 8, name: "Realms", parent_category_id: null },
];

function trackerPost(fields: Partial<TrackerPost> = {}): TrackerPost {
  return {
    id: 5_000_001,
    created_at: "2026-09-24T22:37:36.828Z",
    topic_id: 600_001,
    topic_title: "Made-up Beta Development Notes",
    url: "/t/made-up-beta-development-notes/600001/1",
    category_id: 41,
    post_number: 1,
    username: "MadeUpCM-1234",
    name: "Made-up CM",
    user_title: "Made-up Manager",
    avatar_template: "/en/wow/user_avatar/eu.forums.example/madeupcm-1234/{size}/1_2.png",
    excerpt: "Today we updated the beta.",
    ...fields,
  };
}

// The address a fetch asked for.
function urlOf(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input instanceof URL ? input.href : input;
}

function json(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Answers the group's posts page and the site's categories. Later calls can give different pages.
function createFakeFetch(...trackerPages: TrackerPost[][]) {
  let page = 0;
  return vi.fn<typeof fetch>((input) => {
    const url = urlOf(input);
    if (url === `${forum}/site.json`) {
      return Promise.resolve(json({ categories }));
    }
    if (url === `${forum}/groups/${group}/posts.json`) {
      const posts = trackerPages[Math.min(page, trackerPages.length - 1)] ?? [];
      page += 1;
      return Promise.resolve(json({ posts }));
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  });
}

describe("createForumReader", () => {
  it("reads the staff posts with their forum and a link to each", async () => {
    const fetch = createFakeFetch([
      trackerPost(),
      trackerPost({
        id: 5_000_002,
        topic_id: 600_002,
        post_number: 4,
        topic_title: "Made-up Question",
        url: "/t/made-up-question/600002/4",
        category_id: 7,
        excerpt: "We're looking into it.",
      }),
    ]);

    const posts = await createForumReader({ fetch, forum })(group);

    expect(posts).toEqual([
      {
        id: 5_000_001,
        createdAt: new Date("2026-09-24T22:37:36.828Z"),
        author: "Made-up CM",
        authorTitle: "Made-up Manager",
        avatarUrl:
          "https://eu.forums.example/en/wow/user_avatar/eu.forums.example/madeupcm-1234/96/1_2.png",
        topicTitle: "Made-up Beta Development Notes",
        url: `${forum}/t/made-up-beta-development-notes/600001/1`,
        linkEnd: "/600001/1",
        isReply: false,
        forum: { name: "WoW: Forever General Discussion", parent: "WoW: Forever" },
        excerpt: "Today we updated the beta.",
      },
      {
        id: 5_000_002,
        createdAt: new Date("2026-09-24T22:37:36.828Z"),
        author: "Made-up CM",
        authorTitle: "Made-up Manager",
        avatarUrl:
          "https://eu.forums.example/en/wow/user_avatar/eu.forums.example/madeupcm-1234/96/1_2.png",
        topicTitle: "Made-up Question",
        url: `${forum}/t/made-up-question/600002/4`,
        linkEnd: "/600002/4",
        isReply: true,
        forum: { name: "News", parent: undefined },
        excerpt: "We're looking into it.",
      },
    ]);
  });

  it("names an author without a display name by their username", async () => {
    const fetch = createFakeFetch([trackerPost({ name: null })]);

    const [post] = await createForumReader({ fetch, forum })(group);

    expect(post?.author).toBe("MadeUpCM-1234");
  });

  it("gives no title for a poster without one", async () => {
    const fetch = createFakeFetch([trackerPost({ user_title: null })]);

    const [post] = await createForumReader({ fetch, forum })(group);

    expect(post?.authorTitle).toBeUndefined();
  });

  it("turns the excerpt's HTML into plain text, leaving out links to header images", async () => {
    const excerpt = [
      '<a name="p-1-change-log-1" class="anchor" href="#p-1-change-log-1"></a>Change Log',
      "",
      "Fixed casters&rsquo; animations &amp; sounds&#8230; mostly.",
      '<a href="https://example.com/header.png">[Made-up News Headline]</a> Read more about&hel',
    ].join("\n");
    const fetch = createFakeFetch([trackerPost({ excerpt })]);

    const [post] = await createForumReader({ fetch, forum })(group);

    expect(post?.excerpt).toBe(
      ["Change Log", "", "Fixed casters’ animations & sounds… mostly.", "Read more about…"].join(
        "\n",
      ),
    );
  });

  it("looks up the forum's categories once, and again when a post is in a new one", async () => {
    const fetch = createFakeFetch(
      [trackerPost()],
      [trackerPost()],
      [trackerPost({ id: 5_000_003, category_id: 99 })],
    );
    const readPosts = createForumReader({ fetch, forum });

    await readPosts(group);
    await readPosts(group);
    await readPosts(group);

    const siteLookups = fetch.mock.calls.filter(([input]) => urlOf(input).endsWith("/site.json"));
    expect(siteLookups).toHaveLength(2);
  });

  it("fails, naming the page, when the forum doesn't answer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("Service Unavailable", { status: 503 })),
    );

    await expect(createForumReader({ fetch, forum })(group)).rejects.toThrow(
      new Error("The forum answered HTTP 503 for /groups/made-up-staff/posts.json."),
    );
  });

  it("reads a post by a poster without an avatar", async () => {
    const fetch = createFakeFetch([trackerPost({ avatar_template: null })]);

    const [post] = await createForumReader({ fetch, forum })(group);

    expect(post?.avatarUrl).toBeUndefined();
  });

  it("reads a post in a forum whose parent is given as null", async () => {
    const fetch = createFakeFetch([trackerPost({ category_id: 8 })]);

    const [post] = await createForumReader({ fetch, forum })(group);

    expect(post?.forum).toEqual({ name: "Realms", parent: undefined });
  });

  it("fails when the group's page lists no posts, which it never really does", async () => {
    const fetch = createFakeFetch([]);

    await expect(createForumReader({ fetch, forum })(group)).rejects.toThrow(
      new Error("The forum listed no posts for made-up-staff."),
    );
  });

  it("refuses a post whose time isn't one", async () => {
    const fetch = createFakeFetch([trackerPost({ created_at: "yesterday" })]);

    await expect(createForumReader({ fetch, forum })(group)).rejects.toThrow(ZodError);
  });
});
