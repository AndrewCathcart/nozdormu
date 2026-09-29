import type { APIEmbed } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import type { StaffPost } from "./forum.ts";
import { formatStaffPost } from "./format.ts";

const url = "https://eu.forums.example/en/wow/t/made-up-beta-development-notes/600001/1";
const avatarUrl = "https://eu.forums.example/en/wow/user_avatar/madeupcm/96/1_2.png";

function post(fields: Partial<StaffPost> = {}): StaffPost {
  return {
    id: 5_000_001,
    createdAt: new Date("2026-09-24T22:37:36.828Z"),
    author: "MadeUpCM",
    authorTitle: "Made-up Manager",
    avatarUrl,
    topicTitle: "Made-up Beta Development Notes",
    url,
    linkEnd: "/600001/1",
    isReply: false,
    forum: { name: "WoW: Forever General Discussion", parent: "WoW: Forever" },
    excerpt: "Today we updated the beta.\nMore soon.",
    ...fields,
  };
}

// The card announcing a made-up post with these fields.
function card(fields: Partial<StaffPost>): APIEmbed {
  const [embed] = formatStaffPost(post(fields)).embeds ?? [];
  if (embed === undefined) {
    throw new Error("The message has no card.");
  }
  return embed;
}

describe("formatStaffPost", () => {
  it("shows who posted, the linked topic, the post's opening, the forum and when", () => {
    expect(formatStaffPost(post())).toEqual({
      embeds: [
        {
          // Blizzard blue.
          color: 0x14_8e_ff,
          author: { name: "MadeUpCM · Made-up Manager", icon_url: avatarUrl },
          title: "Made-up Beta Development Notes",
          url,
          description: "Today we updated the beta.\nMore soon.",
          footer: { text: "New topic in WoW: Forever General Discussion" },
          timestamp: "2026-09-24T22:37:36.828Z",
        },
      ],
      allowed_mentions: { parse: [] },
      // Discord drops a repeat of the same message sent within a few minutes.
      nonce: "blue-5000001",
      enforce_nonce: true,
    });
  });

  it("says a reply is a reply", () => {
    expect(card({ isReply: true }).footer).toEqual({
      text: "Reply in WoW: Forever General Discussion",
    });
  });

  it("says the forums when it doesn't know the post's forum", () => {
    expect(card({ forum: undefined }).footer).toEqual({ text: "New topic in the forums" });
  });

  it("names a poster without a title or an avatar by their name alone", () => {
    expect(card({ authorTitle: undefined, avatarUrl: undefined }).author).toEqual({
      name: "MadeUpCM",
    });
  });

  it("shortens a long opening at a word, with an ellipsis", () => {
    // 100 words of 5 letters: 599 characters with the spaces.
    const excerpt = Array.from({ length: 100 }, () => "words").join(" ");

    expect(card({ excerpt }).description).toBe(
      `${Array.from({ length: 66 }, () => "words").join(" ")}…`,
    );
  });

  it("escapes Discord markdown in the title and the opening", () => {
    const { title, description } = card({
      topicTitle: "[Beta] *New* build",
      excerpt: "Use `/reload` after_patching.",
    });

    expect([title, description]).toEqual([
      "\\[Beta\\] \\*New\\* build",
      "Use \\`/reload\\` after\\_patching.",
    ]);
  });

  it("leaves the poster's name as it is, since the author line shows no markdown", () => {
    expect(card({ author: "Made_up_CM", authorTitle: undefined }).author?.name).toBe("Made_up_CM");
  });

  it("leaves out the opening when the post has no text", () => {
    expect(card({ excerpt: "" }).description).toBeUndefined();
  });

  it("shortens a very long title, so the card stays within Discord's limit", () => {
    expect(card({ topicTitle: "a".repeat(300) }).title).toBe(`${"a".repeat(120)}…`);
  });
});
