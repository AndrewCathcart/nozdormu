import { describe, expect, it } from "vitest";
import { parseFeed } from "./feed.ts";
import { buildFeed } from "./test-feed.ts";

describe("parseFeed", () => {
  it("reads each video's ID, link and publish time, in feed order", () => {
    const xml = buildFeed([
      { id: "bbbbbbbbbbb", title: "Second video", published: "2026-09-28T20:00:00+00:00" },
      { id: "aaaaaaaaaaa", title: "First video", published: "2026-09-27T09:30:00+00:00" },
    ]);

    expect(parseFeed(xml)).toEqual([
      {
        id: "bbbbbbbbbbb",
        url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        publishedAt: new Date("2026-09-28T20:00:00Z"),
      },
      {
        id: "aaaaaaaaaaa",
        url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        publishedAt: new Date("2026-09-27T09:30:00Z"),
      },
    ]);
  });

  it("reads a feed with no videos as an empty list", () => {
    expect(parseFeed(buildFeed([]))).toEqual([]);
  });

  it("refuses something that isn't a feed", () => {
    expect(() => parseFeed("<html><body>Something went wrong</body></html>")).toThrow(
      new Error("The YouTube feed didn't have the expected shape."),
    );
  });
});
