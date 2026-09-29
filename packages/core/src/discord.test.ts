import { Routes } from "discord-api-types/v10";
import type { REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";
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
  it("returns the text of the bot's own messages among the channel's recent ones", async () => {
    const rest = createFakeRest([
      { author: { id: botUserId }, content: "ScotteJaye just posted a new video!" },
      { author: { id: "800000000000000008" }, content: "Made-up chat message" },
    ]);

    expect(await createRecentPostReader(rest)(channelId)).toEqual([
      "ScotteJaye just posted a new video!",
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
    const rest = createFakeRest([{ author: { id: botUserId }, content: "Posted earlier" }]);
    rest.get.mockRejectedValueOnce(new Error("Discord is down"));
    const readRecentPosts = createRecentPostReader(rest);
    await expect(readRecentPosts(channelId)).rejects.toThrow("Discord is down");

    expect(await readRecentPosts(channelId)).toEqual(["Posted earlier"]);
  });
});

describe("createChannelPublisher", () => {
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
