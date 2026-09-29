import type { ChatChannel, Week } from "./chat.ts";

// One part of the digest, such as "Decided" or "Coming up".
export interface Section {
  readonly heading: string;
  readonly body: string;
}

// A week's catch-up, for members who didn't read all the chat.
export interface Digest {
  readonly sections: readonly Section[];
}

// Writes the week's digest from its chat.
export type DigestWriter = (chat: readonly ChatChannel[], week: Week) => Promise<Digest>;
