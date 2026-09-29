// The named entities the forum's excerpts use.
const namedEntities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
};

// The highest Unicode code point.
const maxCodePoint = 0x10_ff_ff;

// The character a numeric entity stands for, or the entity itself if it isn't one.
function fromCodePoint(entity: string, codePoint: number): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= maxCodePoint
    ? String.fromCodePoint(codePoint)
    : entity;
}

function decodeEntity(entity: string, name: string): string {
  if (name.startsWith("#x") || name.startsWith("#X")) {
    return fromCodePoint(entity, Number.parseInt(name.slice(2), 16));
  }
  if (name.startsWith("#")) {
    return fromCodePoint(entity, Number.parseInt(name.slice(1), 10));
  }
  return namedEntities[name] ?? entity;
}

// A forum excerpt's HTML as plain text: tags dropped (keeping their text), entities decoded, and an
// entity cut off by the excerpt's end replaced with an ellipsis. A link Discourse shows as
// "[Title]" stands for an image or video. A video keeps its title; an image, usually a news post's
// header repeating its title, is left out, as is a news post's "View Full Article" link.
export function htmlToText(html: string): string {
  return html
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<a\b[^>]*class="video-thumbnail"[^>]*>\s*\[([^\]<]*)\]\s*<\/a>/gi, "▶ $1")
    .replaceAll(/<a\b[^>]*>\s*\[[^\]<]*\]\s*<\/a>\s*/gi, "")
    .replaceAll(/\s*<a\b[^>]*>View Full Article<\/a>/gi, "")
    .replaceAll(/<[^>]*>/g, "")
    .replace(/&[#a-z0-9]*$/i, "…")
    .replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) =>
      decodeEntity(entity, name),
    )
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}
