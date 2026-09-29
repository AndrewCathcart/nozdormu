import { parse } from "csv-parse/sync";
import { z } from "zod";

export interface ItemRecord {
  readonly id: number;
  readonly name: string;
  readonly quality: number;
  readonly itemLevel: number;
  readonly requiredLevel: number;
  readonly inventoryType: number;
}

const wholeNumber = z
  .string()
  .regex(/^-?\d+$/)
  .transform((value) => Number.parseInt(value, 10));

const row = z.object({
  ID: wholeNumber,
  Display_lang: z.string(),
  OverallQualityID: wholeNumber,
  ItemLevel: wholeNumber,
  RequiredLevel: wholeNumber,
  InventoryType: wholeNumber,
});

// Reads the columns we use from wago.tools' ItemSparse CSV export, ignoring the rest.
export function parseItemSparse(csv: string): ItemRecord[] {
  const records: unknown = parse(csv, { columns: true, skip_empty_lines: true });
  const rows = z.array(row).safeParse(records);
  if (!rows.success) {
    throw new Error("ItemSparse didn't have the expected columns.", { cause: rows.error });
  }
  return rows.data.map((item) => ({
    id: item.ID,
    name: item.Display_lang,
    quality: item.OverallQualityID,
    itemLevel: item.ItemLevel,
    requiredLevel: item.RequiredLevel,
    inventoryType: item.InventoryType,
  }));
}
