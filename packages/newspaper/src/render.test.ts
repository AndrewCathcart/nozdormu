import { describe, expect, it } from "vitest";
import { renderIssue } from "./render.ts";

const issueDate = new Date("2026-09-28T08:00:00Z");

describe("renderIssue", () => {
  it("opens with the masthead and puts each story under its headline", () => {
    const messages = renderIssue("The Test Gazette", issueDate, {
      stories: [
        { headline: "SPREADSHEET SHOCK", body: "Brannoc has made a spreadsheet." },
        { headline: "Weather", body: "Cloudy over Elwynn.\n\nRain later." },
      ],
    });

    expect(messages).toEqual([
      [
        "# 📰 The Test Gazette",
        "-# Monday 28 September 2026",
        "",
        "## SPREADSHEET SHOCK",
        "Brannoc has made a spreadsheet.",
        "",
        "## Weather",
        "Cloudy over Elwynn.",
        "",
        "Rain later.",
      ].join("\n"),
    ]);
  });

  it("moves a story that won't fit to the next message, keeping it whole", () => {
    const longBody = "a".repeat(1500);
    const twoParagraphs = `${"b".repeat(300)}\n\n${"c".repeat(300)}`;

    const messages = renderIssue("The Test Gazette", issueDate, {
      stories: [
        { headline: "First", body: longBody },
        { headline: "Second", body: twoParagraphs },
      ],
    });

    expect(messages).toEqual([
      `# 📰 The Test Gazette\n-# Monday 28 September 2026\n\n## First\n${longBody}`,
      `## Second\n${twoParagraphs}`,
    ]);
  });

  it("splits a story too long for one message between its paragraphs", () => {
    const paragraphs = ["a", "b", "c"].map((letter) => letter.repeat(900));

    const messages = renderIssue("The Test Gazette", issueDate, {
      stories: [{ headline: "Long", body: paragraphs.join("\n\n") }],
    });

    expect(messages).toEqual([
      `# 📰 The Test Gazette\n-# Monday 28 September 2026\n\n## Long\n${paragraphs[0] ?? ""}\n\n${paragraphs[1] ?? ""}`,
      paragraphs[2],
    ]);
  });

  it("splits a paragraph too long for one message between words", () => {
    // 50 words of 99 letters, 100 characters each with a space. The masthead takes 49 characters
    // and "\n\n## L\n" 6 more, so the first message fits 19 words (1,955 characters), the second
    // 20 (1,999) and the third the last 11.
    const word = "x".repeat(99);
    const words = (count: number): string => Array.from({ length: count }, () => word).join(" ");

    const messages = renderIssue("The Test Gazette", issueDate, {
      stories: [{ headline: "L", body: words(50) }],
    });

    expect(messages).toEqual([
      `# 📰 The Test Gazette\n-# Monday 28 September 2026\n\n## L\n${words(19)}`,
      words(20),
      words(11),
    ]);
  });
});
