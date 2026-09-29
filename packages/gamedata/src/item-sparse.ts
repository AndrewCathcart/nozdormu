import { z } from "zod";
import { readTable, wholeNumber } from "./csv.ts";

export interface ItemRecord {
  readonly id: number;
  readonly name: string;
  readonly quality: number;
  readonly itemLevel: number;
  readonly requiredLevel: number;
  readonly inventoryType: number;
}

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
  return readTable("ItemSparse", csv, row).map((item) => ({
    id: item.ID,
    name: item.Display_lang,
    quality: item.OverallQualityID,
    itemLevel: item.ItemLevel,
    requiredLevel: item.RequiredLevel,
    inventoryType: item.InventoryType,
  }));
}
