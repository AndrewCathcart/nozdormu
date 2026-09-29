import { describe, expect, it } from "vitest";
import { htmlToText } from "./text.ts";

describe("htmlToText", () => {
  it("keeps a numeric entity that isn't a real character as it is", () => {
    expect(htmlToText("Broken &#99999999; and &#x110000; entities")).toBe(
      "Broken &#99999999; and &#x110000; entities",
    );
  });

  it("keeps a video's title, marked as a video", () => {
    const html = [
      '<a href="https://www.youtube.com/watch?v=made-up" target="_blank" class="video-thumbnail" rel="noopener">',
      "    [Made-up Panel &#39;26]",
      "  </a>",
    ].join("\n");

    expect(htmlToText(html)).toBe("▶ Made-up Panel '26");
  });

  it("leaves out a news post's link to the full article", () => {
    expect(
      htmlToText(
        'Watch the first episode.  <a href="https://worldofwarcraft.example/news/1">View Full Article</a>',
      ),
    ).toBe("Watch the first episode.");
  });
});
