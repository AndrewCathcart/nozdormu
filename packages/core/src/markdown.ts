// Text shown as itself in a Discord message: characters Discord's markdown would act on are
// escaped.
export function escapeMarkdown(text: string): string {
  return text.replaceAll(/[\\*_~`|>[\]]/g, (character) => `\\${character}`);
}
