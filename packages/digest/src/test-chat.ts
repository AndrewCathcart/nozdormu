import type { ChatMessage, Week } from "./chat.ts";

// Monday 21 September 2026 09:00 UK time to the Monday after, the week the tests' made-up chat is
// from.
export const lastWeek = {
  from: new Date("2026-09-21T08:00:00Z"),
  to: new Date("2026-09-28T08:00:00Z"),
} satisfies Week;

// A made-up message, sent on Monday 21 September at 09:12 UK time.
export function chatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    authorName: "Brannoc",
    sentAt: new Date("2026-09-21T08:12:00Z"),
    text: "I have made a spreadsheet.",
    replyTo: undefined,
    reactions: 0,
    attachments: 0,
    ...overrides,
  };
}
