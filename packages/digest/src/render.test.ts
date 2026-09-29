import { describe, expect, it } from "vitest";
import { captionedMasthead, renderDigest } from "./render.ts";
import { lastWeek } from "./test-chat.ts";

// The masthead: "# 📰 This week in the guild" and the week's dates below it.
const masthead = "# 📰 This week in the guild\n-# Monday 21 September to Monday 28 September 2026";

describe("renderDigest", () => {
  it("opens with the masthead and the week on their own, then puts each section under its heading", () => {
    const messages = renderDigest(lastWeek, {
      sections: [
        { heading: "Decided", body: "- Raids on Wednesdays and Sundays." },
        { heading: "Highlights", body: "Odaline's dog opened the fridge.\n\nThen closed it." },
      ],
    });

    expect(messages).toEqual([
      masthead,
      [
        "## Decided",
        "- Raids on Wednesdays and Sundays.",
        "",
        "## Highlights",
        "Odaline's dog opened the fridge.",
        "",
        "Then closed it.",
      ].join("\n"),
    ]);
  });

  it("moves a section that won't fit to the next message, keeping it whole", () => {
    const longBody = "a".repeat(1500);
    const twoParagraphs = `${"b".repeat(300)}\n\n${"c".repeat(300)}`;

    const messages = renderDigest(lastWeek, {
      sections: [
        { heading: "First", body: longBody },
        { heading: "Second", body: twoParagraphs },
      ],
    });

    expect(messages).toEqual([masthead, `## First\n${longBody}`, `## Second\n${twoParagraphs}`]);
  });

  it("splits a section too long for one message between its paragraphs", () => {
    const paragraphs = ["a", "b", "c"].map((letter) => letter.repeat(900));

    const messages = renderDigest(lastWeek, {
      sections: [{ heading: "Long", body: paragraphs.join("\n\n") }],
    });

    expect(messages).toEqual([
      masthead,
      `## Long\n${paragraphs[0] ?? ""}\n\n${paragraphs[1] ?? ""}`,
      paragraphs[2],
    ]);
  });

  it("splits a paragraph too long for one message between words", () => {
    // 50 words of 99 letters, 100 characters each with a space. The heading takes 5 characters
    // ("## L" and a line break), so the message after the masthead fits 19 words (1,904 characters),
    // the next 20 (1,999) and the last the remaining 11.
    const word = "x".repeat(99);
    const words = (count: number): string => Array.from({ length: count }, () => word).join(" ");

    const messages = renderDigest(lastWeek, { sections: [{ heading: "L", body: words(50) }] });

    expect(messages).toEqual([masthead, `## L\n${words(19)}`, words(20), words(11)]);
  });
});

describe("captionedMasthead", () => {
  it("puts the cartoon's caption under the masthead in italics, with its markdown escaped", () => {
    expect(captionedMasthead(masthead, "The week *everyone* wiped.")).toBe(
      `${masthead}\n\n*The week \\*everyone\\* wiped.*`,
    );
  });

  it("shortens a caption longer than 200 characters", () => {
    expect(captionedMasthead(masthead, "a".repeat(300))).toBe(
      `${masthead}\n\n*${"a".repeat(199)}…*`,
    );
  });
});
