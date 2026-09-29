import { parseFeed, type Video } from "./feed.ts";

export type FeedReader = (url: string) => Promise<Video[]>;

export interface FeedReaderOptions {
  readonly fetch: typeof fetch;
  readonly attempts: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Fetches and reads a YouTube feed. The feed often fails for a few seconds at a time (HTTP 404 or
// 500), so each failure is retried, and only the last one fails the check.
export function createFeedReader(options: FeedReaderOptions): FeedReader {
  const readOnce = async (url: string): Promise<Video[]> => {
    // A plain timer rather than AbortSignal.timeout, so tests can control it.
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new Error(`The YouTube feed didn't answer within ${String(options.timeoutMs)} ms.`),
      );
    }, options.timeoutMs);
    try {
      const response = await options.fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`The YouTube feed answered HTTP ${String(response.status)}.`);
      }
      return parseFeed(await response.text());
    } finally {
      clearTimeout(timeout);
    }
  };

  return async (url) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await readOnce(url);
      } catch (error) {
        if (attempt >= options.attempts) {
          throw error;
        }
        await wait(options.retryDelayMs);
      }
    }
  };
}

export const readFeedOverHttp = createFeedReader({
  fetch,
  attempts: 3,
  retryDelayMs: 3000,
  timeoutMs: 10_000,
});
