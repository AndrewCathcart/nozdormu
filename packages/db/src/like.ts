// Text for a LIKE or ILIKE pattern, so "%" and "_" in what someone types match themselves, not any
// characters.
export function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/g, (character) => `\\${character}`);
}
