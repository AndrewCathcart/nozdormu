import type { ChatChannel, Week } from "./chat.ts";

// One part of the digest, such as "Decided" or "Coming up".
export interface Section {
  readonly heading: string;
  readonly body: string;
}

// A week's catch-up, for members who didn't read all the chat.
export interface Digest {
  readonly sections: readonly Section[];
  // One scene from the week, described for a painter, without members' names.
  readonly illustration: string;
}

// Writes the week's digest from its chat.
export type DigestWriter = (chat: readonly ChatChannel[], week: Week) => Promise<Digest>;

// A picture to post with the digest.
export interface Illustration {
  readonly data: Uint8Array;
  readonly fileName: string;
}

// Paints a scene Claude described.
export type Illustrator = (scene: string) => Promise<Illustration>;
