import { type ChannelMessage, escapeMarkdown } from "@nozdormu/core";
import type { StaffPost } from "./forum.ts";

// How much of a post's opening to show (the link has the rest), and how much of a topic's title and
// a poster's name and title. Even with every character escaped, they stay within Discord's embed
// limits: 256 characters for the title and the author line, 4,096 for the description.
const maxOpeningLength = 400;
const maxTitleLength = 120;
const maxNameLength = 80;

const blizzardBlue = 0x14_8e_ff;

// The text, cut at the last whole word within the limit, with an ellipsis if anything was cut.
function shortened(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// The Discord message announcing a staff post: a card showing who posted, the linked topic, the
// post's opening, the forum and when. Discord renders markdown in an embed's title and description,
// but not in its author line or footer.
export function formatStaffPost(post: StaffPost): ChannelMessage {
  const author = [post.author, post.authorTitle]
    .filter((part) => part !== undefined)
    .map((part) => shortened(part, maxNameLength))
    .join(" · ");
  const opening = shortened(post.excerpt, maxOpeningLength);
  return {
    embeds: [
      {
        color: blizzardBlue,
        author: {
          name: author,
          ...(post.avatarUrl === undefined ? {} : { icon_url: post.avatarUrl }),
        },
        title: escapeMarkdown(shortened(post.topicTitle, maxTitleLength)),
        url: post.url,
        ...(opening === "" ? {} : { description: escapeMarkdown(opening) }),
        footer: {
          text: `${post.isReply ? "Reply" : "New topic"} in ${post.forum?.name ?? "the forums"}`,
        },
        timestamp: post.createdAt.toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
    nonce: `blue-${String(post.id)}`,
    enforce_nonce: true,
  };
}
