import type { ChatChannel, Week } from "./chat.ts";

// The newspaper's name and the voice Claude writes it in.
export interface Paper {
  readonly name: string;
  readonly voice: string;
}

export interface Story {
  readonly headline: string;
  readonly body: string;
}

export interface Issue {
  readonly stories: readonly Story[];
}

// Writes the week's issue from its chat.
export type IssueWriter = (chat: readonly ChatChannel[], week: Week) => Promise<Issue>;
