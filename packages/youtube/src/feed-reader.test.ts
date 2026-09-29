import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedReader, type FeedReaderOptions } from "./feed-reader.ts";
import { buildFeed } from "./test-feed.ts";

const url = "https://www.youtube.com/feeds/videos.xml?channel_id=UC0000000000000000000000";
const feed = buildFeed([
  { id: "aaaaaaaaaaa", title: "Made up", published: "2026-09-28T10:00:00+00:00" },
]);
const videos = [
  {
    id: "aaaaaaaaaaa",
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    publishedAt: new Date("2026-09-28T10:00:00Z"),
  },
];

function respond(status: number, body = feed): Response {
  return new Response(body, { status });
}

// A fetch that never answers, and fails only once its request is aborted.
const hangUntilAborted: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new Error("The request timed out."));
    });
  });

function readerWith(fakeFetch: FeedReaderOptions["fetch"]) {
  return createFeedReader({ fetch: fakeFetch, attempts: 3, retryDelayMs: 3000, timeoutMs: 10_000 });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createFeedReader", () => {
  it("retries a failed response and reads the feed once a retry succeeds", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(500))
      .mockResolvedValueOnce(respond(200));

    const result = readerWith(fakeFetch)(url);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toEqual(videos);
  });

  it("gives up after the last attempt, failing with that attempt's error", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(500))
      .mockResolvedValueOnce(respond(500))
      .mockResolvedValueOnce(respond(404));

    // Caught now, so the rejection is handled while the retries are still waiting.
    const failure = readerWith(fakeFetch)(url).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(6000);

    expect(await failure).toEqual(new Error("The YouTube feed answered HTTP 404."));
    expect(fakeFetch).toHaveBeenCalledTimes(3);
  });

  it("retries after a network error", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(respond(200));

    const result = readerWith(fakeFetch)(url);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toEqual(videos);
  });

  it("waits the retry delay before trying again", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(500))
      .mockResolvedValueOnce(respond(200));

    const result = readerWith(fakeFetch)(url);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fakeFetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(fakeFetch).toHaveBeenCalledTimes(2);
    await result;
  });

  it("retries a response that isn't a readable feed", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(200, "<html><body>Something went wrong</body></html>"))
      .mockResolvedValueOnce(respond(200));

    const result = readerWith(fakeFetch)(url);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toEqual(videos);
  });
  it("gives up on a request that takes longer than the timeout, and retries", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(hangUntilAborted)
      .mockResolvedValueOnce(respond(200));

    const result = readerWith(fakeFetch)(url);
    await vi.advanceTimersByTimeAsync(10_000 + 3000);

    await expect(result).resolves.toEqual(videos);
  });
});
