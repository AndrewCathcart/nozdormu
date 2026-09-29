import type { RawFile } from "discord.js";
import type { ChatChannel, Week } from "./chat.ts";

// One part of the digest, such as "Decided" or "Coming up".
export interface Section {
  readonly heading: string;
  readonly body: string;
}

// One moment from the week, for the cartoon at the top of the digest.
export interface Cartoon {
  // Described for the cartoonist, without members' names or words.
  readonly scene: string;
  // Says which moment it is, above the picture. Names are fine here.
  readonly caption: string | undefined;
}

// A week's catch-up, for members who didn't read all the chat.
export interface Digest {
  readonly sections: readonly Section[];
  // Left out when Claude describes no scene.
  readonly cartoon: Cartoon | undefined;
}

// Writes the week's digest from its chat.
export type DigestWriter = (chat: readonly ChatChannel[], week: Week) => Promise<Digest>;

// A picture to post with the digest, as a file to upload.
export type Illustration = RawFile;

// Draws a scene Claude described.
export type Illustrator = (scene: string) => Promise<Illustration>;
