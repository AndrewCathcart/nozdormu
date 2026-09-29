import { shortDateTime } from "./uk-time.ts";

// One message someone wrote in a channel the digest reads.
export interface ChatMessage {
  // The author's server nickname, or their Discord display name if they have none.
  readonly authorName: string;
  readonly sentAt: Date;
  readonly text: string;
  // The name of the author of the message this one replies to, if it's a reply.
  readonly replyTo: string | undefined;
  readonly reactions: number;
  readonly attachments: number;
}

export interface ChatChannel {
  readonly name: string;
  readonly messages: readonly ChatMessage[];
}

// The week a digest covers: Monday 09:00 to Monday 09:00, UK time.
export interface Week {
  readonly from: Date;
  readonly to: Date;
}

// Reads what people wrote in the given channels during the week.
export type ChatReader = (channelIds: readonly string[], week: Week) => Promise<ChatChannel[]>;

// The most recent messages whose lines in the transcript (with their channels' headings) add up
// to at most maxCharacters, still grouped by channel and in order.
export function latestChat(
  channels: readonly ChatChannel[],
  maxCharacters: number,
): { readonly chat: ChatChannel[]; readonly kept: number; readonly dropped: number } {
  const newestFirst = channels
    .flatMap((channel) => channel.messages.map((message) => ({ channel, message })))
    .toSorted((a, b) => b.message.sentAt.getTime() - a.message.sentAt.getTime());
  const kept = new Set<ChatMessage>();
  const headed = new Set<ChatChannel>();
  let characters = 0;
  for (const { channel, message } of newestFirst) {
    // A heading, a line break and a blank line after it; then the message's line and a line break.
    const heading = headed.has(channel) ? 0 : `#${channel.name}`.length + 2;
    characters += heading + formatMessage(message).length + 1;
    if (characters > maxCharacters) {
      break;
    }
    headed.add(channel);
    kept.add(message);
  }
  return {
    chat: channels.map((channel) => ({
      name: channel.name,
      messages: channel.messages.filter((message) => kept.has(message)),
    })),
    kept: kept.size,
    dropped: newestFirst.length - kept.size,
  };
}

function count(amount: number, noun: string): string {
  return `[${String(amount)} ${noun}${amount === 1 ? "" : "s"}]`;
}

function formatMessage(message: ChatMessage): string {
  const author =
    message.replyTo === undefined
      ? message.authorName
      : `${message.authorName} (replying to ${message.replyTo})`;
  const notes = [
    ...(message.attachments > 0 ? [count(message.attachments, "attachment")] : []),
    ...(message.reactions > 0 ? [count(message.reactions, "reaction")] : []),
  ];
  // Later lines are indented, so each message still starts its own unindented line.
  const text = message.text.split("\n").join("\n  ");
  return [`[${shortDateTime(message.sentAt)}] ${author}: ${text}`, ...notes].join(" ");
}

// The week's chat as plain text for Claude to read, one line per message.
export function formatChat(channels: readonly ChatChannel[]): string {
  return channels
    .map((channel) => [`#${channel.name}`, ...channel.messages.map(formatMessage)].join("\n"))
    .join("\n\n");
}
