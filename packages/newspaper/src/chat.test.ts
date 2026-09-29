import { describe, expect, it } from "vitest";
import { formatChat, latestChat } from "./chat.ts";
import { chatMessage as message } from "./test-chat.ts";

describe("formatChat", () => {
  it("lists each channel's messages under its name, with the UK day and time and the author", () => {
    const transcript = formatChat([
      {
        name: "general",
        messages: [
          message(),
          message({
            authorName: "Mirelle",
            sentAt: new Date("2026-09-22T19:05:00Z"),
            text: "Of course you have.",
          }),
        ],
      },
      {
        name: "raid-planning",
        messages: [message({ authorName: "Tukk", text: "Tuesday raids?" })],
      },
    ]);

    expect(transcript).toBe(
      [
        "#general",
        "[Mon 21 Sep 09:12] Brannoc: I have made a spreadsheet.",
        "[Tue 22 Sep 20:05] Mirelle: Of course you have.",
        "",
        "#raid-planning",
        "[Mon 21 Sep 09:12] Tukk: Tuesday raids?",
      ].join("\n"),
    );
  });

  it("notes replies, attachments and reactions", () => {
    const transcript = formatChat([
      {
        name: "general",
        messages: [
          message({
            authorName: "Odaline",
            text: "My dog has learned to open the fridge.",
            replyTo: "Brannoc",
            attachments: 1,
            reactions: 14,
          }),
          message({ authorName: "Pip", text: "Pictures!", attachments: 2, reactions: 1 }),
        ],
      },
    ]);

    expect(transcript).toBe(
      [
        "#general",
        "[Mon 21 Sep 09:12] Odaline (replying to Brannoc): My dog has learned to open the fridge. [1 attachment] [14 reactions]",
        "[Mon 21 Sep 09:12] Pip: Pictures! [2 attachments] [1 reaction]",
      ].join("\n"),
    );
  });

  it("indents the later lines of a message that runs over several", () => {
    const transcript = formatChat([
      { name: "general", messages: [message({ text: "Week 1: spreadsheet\nWeek 2: more tabs" })] },
    ]);

    expect(transcript).toBe(
      ["#general", "[Mon 21 Sep 09:12] Brannoc: Week 1: spreadsheet", "  Week 2: more tabs"].join(
        "\n",
      ),
    );
  });
});

describe("latestChat", () => {
  // Each message's line is 30 characters, "[Mon 21 Sep 09:1x] Brannoc: hi", plus a line break, and
  // the channel's heading and the gap after it take 10: "#general", a line break and a blank line.
  const fiveMinutes = [0, 1, 2, 3, 4].map((minute) =>
    message({ sentAt: new Date(Date.UTC(2026, 8, 21, 8, 10 + minute)), text: "hi" }),
  );

  it("keeps the latest messages whose lines in the transcript fit the limit", () => {
    const { chat, kept, dropped } = latestChat([{ name: "general", messages: fiveMinutes }], 103);

    expect(chat).toEqual([{ name: "general", messages: fiveMinutes.slice(2) }]);
    expect({ kept, dropped }).toEqual({ kept: 3, dropped: 2 });
  });

  it("drops one more when the limit falls a character short", () => {
    const { kept } = latestChat([{ name: "general", messages: fiveMinutes }], 102);

    expect(kept).toBe(2);
  });
});
