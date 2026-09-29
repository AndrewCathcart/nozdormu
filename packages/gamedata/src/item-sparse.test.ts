import { describe, expect, it } from "vitest";
import { parseItemSparse } from "./item-sparse.ts";

// The shape of wago.tools' ItemSparse CSV export: many more columns than we use, names quoted when
// they contain commas. The items are made up.
const csv = [
  "ID,Description_lang,Display_lang,ExpansionID,ItemLevel,OverallQualityID,RequiredLevel,InventoryType,StatPercentEditor_0",
  '270001,"",Made-up Sword of Testing,0,42,3,37,13,2500',
  '270002,"A quote, with a comma","Made-up Helm, of Commas",0,60,4,55,1,4000',
].join("\n");

describe("parseItemSparse", () => {
  it("reads each item's ID, name, quality, item level, required level and slot", () => {
    expect(parseItemSparse(csv)).toEqual([
      {
        id: 270001,
        name: "Made-up Sword of Testing",
        quality: 3,
        itemLevel: 42,
        requiredLevel: 37,
        inventoryType: 13,
      },
      {
        id: 270002,
        name: "Made-up Helm, of Commas",
        quality: 4,
        itemLevel: 60,
        requiredLevel: 55,
        inventoryType: 1,
      },
    ]);
  });
  it("refuses a file without the columns it needs", () => {
    expect(() => parseItemSparse("ID,Name\n1,Something")).toThrow(
      new Error("ItemSparse didn't have the expected columns."),
    );
  });
});
