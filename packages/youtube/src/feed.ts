import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

export interface Video {
  readonly id: string;
  readonly url: string;
  readonly publishedAt: Date;
}

// Keep every value a string (a numeric-looking ID stays text), and always give a list of
// entries, even when the feed has one or none.
const parser = new XMLParser({
  parseTagValue: false,
  isArray: (name) => name === "entry",
});

const feedShape = z.object({
  feed: z.object({
    entry: z
      .array(
        z.object({
          "yt:videoId": z.string(),
          published: z.iso.datetime({ offset: true }),
        }),
      )
      .default([]),
  }),
});

// Reads the videos in a channel's YouTube feed, in the feed's order (newest first).
export function parseFeed(xml: string): Video[] {
  const parsed = feedShape.safeParse(parser.parse(xml));
  if (!parsed.success) {
    throw new Error("The YouTube feed didn't have the expected shape.", { cause: parsed.error });
  }
  return parsed.data.feed.entry.map((entry) => ({
    id: entry["yt:videoId"],
    url: `https://www.youtube.com/watch?v=${entry["yt:videoId"]}`,
    publishedAt: new Date(entry.published),
  }));
}
