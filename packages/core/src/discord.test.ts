import { Routes } from "discord-api-types/v10";
import type { REST } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChannelPublisher, createRecentPostReader } from "./discord.ts";

const botUserId = "900000000000000009";
const channelId = "300000000000000003";

function createFakeRest(messages: unknown) {
  return {
    get: vi.fn<REST["get"]>((route) =>
      Promise.resolve(route === Routes.user() ? { id: botUserId } : messages),
    ),
  } satisfies Pick<REST, "get">;
}

describe("createRecentPostReader", () => {
  it("returns the bot's own messages among the channel's recent ones", async () => {
    const rest = createFakeRest([
      { author: { id: botUserId }, content: "ScotteJaye just posted a new video!", embeds: [] },
      { author: { id: "800000000000000008" }, content: "Made-up chat message", embeds: [] },
    ]);

    expect(await createRecentPostReader(rest)(channelId)).toEqual([
      { content: "ScotteJaye just posted a new video!", embedUrls: [] },
    ]);
  });

  it("returns the links of the bot's cards", async () => {
    const rest = createFakeRest([
      {
        author: { id: botUserId },
        content: "",
        embeds: [
          { title: "Made-up News", url: "https://example.com/news/1" },
          { title: "No link" },
        ],
      },
    ]);

    expect(await createRecentPostReader(rest)(channelId)).toEqual([
      { content: "", embedUrls: ["https://example.com/news/1"] },
    ]);
  });

  it("asks Discord for the channel's last 50 messages", async () => {
    const rest = createFakeRest([]);

    await createRecentPostReader(rest)(channelId);

    expect(rest.get).toHaveBeenCalledWith(Routes.channelMessages(channelId), {
      query: new URLSearchParams({ limit: "50" }),
    });
  });

  it("looks up its own user again after a failed lookup", async () => {
    const rest = createFakeRest([
      { author: { id: botUserId }, content: "Posted earlier", embeds: [] },
    ]);
    rest.get.mockRejectedValueOnce(new Error("Discord is down"));
    const readRecentPosts = createRecentPostReader(rest);
    await expect(readRecentPosts(channelId)).rejects.toThrow("Discord is down");

    expect(await readRecentPosts(channelId)).toEqual([
      { content: "Posted earlier", embedUrls: [] },
    ]);
  });
});

function createFakePostingRest() {
  return { post: vi.fn<REST["post"]>().mockResolvedValue({}) } satisfies Pick<REST, "post">;
}

describe("createChannelPublisher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts the message in the channel", async () => {
    const rest = createFakePostingRest();

    await createChannelPublisher(rest)(channelId, { content: "Made-up news" });

    expect(rest.post).toHaveBeenCalledExactlyOnceWith(Routes.channelMessages(channelId), {
      body: { content: "Made-up news" },
    });
  });

  it("waits a second and a half after a post before the next, to stay clear of rate limits", async () => {
    const rest = createFakePostingRest();
    const publish = createChannelPublisher(rest);

    await publish(channelId, { content: "First" });
    const second = publish(channelId, { content: "Second" });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(rest.post).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(rest.post).toHaveBeenCalledTimes(2);
  });

  it("still posts the next message after one fails", async () => {
    const rest = createFakePostingRest();
    rest.post.mockRejectedValueOnce(new Error("Discord is down"));
    const publish = createChannelPublisher(rest);

    await expect(publish(channelId, { content: "First" })).rejects.toThrow("Discord is down");
    const second = publish(channelId, { content: "Second" });
    await vi.advanceTimersByTimeAsync(1_500);
    await second;

    expect(rest.post).toHaveBeenLastCalledWith(Routes.channelMessages(channelId), {
      body: { content: "Second" },
    });
  });

  it("posts the message in the channel, uploading any files with it", async () => {
    const rest = { post: vi.fn<REST["post"]>().mockResolvedValue({}) } satisfies Pick<REST, "post">;

    await createChannelPublisher(rest)(channelId, { content: "Made-up masthead" }, [
      { name: "this-week.jpg", data: new Uint8Array([1, 2, 3]) },
    ]);

    expect(rest.post).toHaveBeenCalledExactlyOnceWith(Routes.channelMessages(channelId), {
      body: { content: "Made-up masthead" },
      files: [{ name: "this-week.jpg", data: new Uint8Array([1, 2, 3]) }],
    });
  });
});
