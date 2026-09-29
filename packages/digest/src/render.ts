import { escapeMarkdown } from "@nozdormu/core";
import type { Week } from "./chat.ts";
import type { Digest, Section } from "./digest.ts";
import { weekDates } from "./uk-time.ts";

// Discord's limit on a message's length.
const maxMessageLength = 2000;

// Far more than the one short line asked for, and short enough that the masthead and caption
// always fit in one message.
const maxCaptionLength = 200;

// The masthead with the cartoon's caption under it, in italics. Discord shows the picture below.
export function captionedMasthead(masthead: string, caption: string): string {
  const shortened =
    caption.length > maxCaptionLength ? `${caption.slice(0, maxCaptionLength - 1)}…` : caption;
  return `${masthead}\n\n*${escapeMarkdown(shortened)}*`;
}

// Fills messages in order, starting a new one whenever the next piece of text won't fit.
class MessagePacker {
  readonly messages: string[] = [];
  private current = "";

  // Adds the text to the current message after the separator, or starts a new message with it.
  // Returns false, adding nothing, if the text is too long for even an empty message.
  add(text: string, separator: string): boolean {
    if (
      this.current !== "" &&
      this.current.length + separator.length + text.length <= maxMessageLength
    ) {
      this.current += separator + text;
      return true;
    }
    if (text.length > maxMessageLength) {
      return false;
    }
    this.finishMessage();
    this.current = text;
    return true;
  }

  finishMessage(): void {
    if (this.current !== "") {
      this.messages.push(this.current);
    }
    this.current = "";
  }
}

// A paragraph too long for one message goes in word by word. A single word longer than a message
// (never seen in prose) is cut.
function addParagraph(packer: MessagePacker, paragraph: string): void {
  if (packer.add(paragraph, "\n\n")) {
    return;
  }
  paragraph.split(" ").forEach((word, index) => {
    const separator = index === 0 ? "\n\n" : " ";
    for (let start = 0; start < word.length; start += maxMessageLength) {
      packer.add(word.slice(start, start + maxMessageLength), start === 0 ? separator : "");
    }
  });
}

// A section stays in one message if it can, and is otherwise split between paragraphs.
function addSection(packer: MessagePacker, section: Section): void {
  const text = `## ${section.heading}\n${section.body}`;
  if (packer.add(text, "\n\n")) {
    return;
  }
  for (const paragraph of text.split("\n\n")) {
    addParagraph(packer, paragraph);
  }
}

// The digest as Discord messages, in posting order: a masthead giving the week, on its own so the
// week's picture can go with it, then the sections.
export function renderDigest(week: Week, digest: Pick<Digest, "sections">): string[] {
  const packer = new MessagePacker();
  packer.add(`# 📰 This week in the guild\n-# ${weekDates(week)}`, "");
  packer.finishMessage();
  for (const section of digest.sections) {
    addSection(packer, section);
  }
  packer.finishMessage();
  return packer.messages;
}
