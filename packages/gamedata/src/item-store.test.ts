import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import type { ItemRecord } from "./item-sparse.ts";
import { createItemStore } from "./item-store.ts";

const database = useTestDatabase();

function item(id: number, name: string): ItemRecord {
  return { id, name, quality: 2, itemLevel: 20, requiredLevel: 15, inventoryType: 13 };
}

describe("item store", () => {
  it("stores an imported build's items and finds one by ID", async () => {
    const store = createItemStore(database.db);

    await store.replaceAll("1.60.1.1001", [item(1, "Made-up Sword"), item(2, "Made-up Helm")]);

    expect(await store.get(2)).toEqual(item(2, "Made-up Helm"));
  });
  it("records which build it imported", async () => {
    const store = createItemStore(database.db);

    await store.replaceAll("1.60.1.1002", [item(1, "Made-up Sword")]);

    expect(await store.importedVersion()).toBe("1.60.1.1002");
  });

  it("replaces the previous build's items", async () => {
    const store = createItemStore(database.db);
    await store.replaceAll("1.60.1.1003", [item(1, "Made-up Sword"), item(2, "Made-up Helm")]);

    await store.replaceAll("1.60.1.1004", [item(2, "Made-up Helm, Renamed")]);

    expect([await store.get(1), await store.get(2)]).toEqual([
      undefined,
      item(2, "Made-up Helm, Renamed"),
    ]);
  });

  it("keeps the previous build when an import fails partway", async () => {
    const store = createItemStore(database.db);
    await store.replaceAll("1.60.1.1005", [item(1, "Made-up Sword")]);

    await expect(
      store.replaceAll("1.60.1.1006", [item(7, "Made-up Duplicate"), item(7, "Made-up Duplicate")]),
    ).rejects.toThrow("Failed query");

    expect([await store.importedVersion(), await store.get(1)]).toEqual([
      "1.60.1.1005",
      item(1, "Made-up Sword"),
    ]);
  });

  it("finds items whose name contains the text, names starting with it first, then shorter ones", async () => {
    const store = createItemStore(database.db);
    await store.replaceAll("1.60.1.1007", [
      item(1, "Made-up Sword of Testing"),
      item(2, "Made-up Sword"),
      item(3, "Sword-shaped Made-up Charm"),
      item(4, "Made-up Helm"),
    ]);

    const found = await store.search("sword", 25);

    expect(found.map((match) => match.name)).toEqual([
      "Sword-shaped Made-up Charm",
      "Made-up Sword",
      "Made-up Sword of Testing",
    ]);
  });

  it("returns at most the number of items asked for", async () => {
    const store = createItemStore(database.db);
    await store.replaceAll(
      "1.60.1.1008",
      Array.from({ length: 30 }, (_, index) =>
        item(index + 1, `Made-up Ring ${String(index + 1)}`),
      ),
    );

    expect(await store.search("ring", 25)).toHaveLength(25);
  });

  it("matches % and _ in the text literally", async () => {
    const store = createItemStore(database.db);
    await store.replaceAll("1.60.1.1009", [
      item(1, "Made-up 50% Potion"),
      item(2, "Made-up Elixir"),
    ]);

    const found = await store.search("%", 25);

    expect(found.map((match) => match.name)).toEqual(["Made-up 50% Potion"]);
  });
  it("leaves deprecated, test and placeholder items out of searches", async () => {
    const store = createItemStore(database.db);
    await store.replaceAll("1.60.1.1010", [
      item(1, "Made-up Blade"),
      item(2, "Made-up Blade DEPRECATED"),
      item(3, "Made-up Blade (Test)"),
      item(4, "Test Made-up Blade"),
      item(5, "[PH] Made-up Blade"),
      item(6, "Made-up Blade (OLD)"),
      item(7, "Unused Made-up Blade"),
      item(8, "Made-up Bladetester"),
    ]);

    const found = await store.search("blade", 25);

    expect(found.map((match) => match.name)).toEqual(["Made-up Blade", "Made-up Bladetester"]);
  });

  it("finds high-test fishing line, whose name only looks like a test item's", async () => {
    const store = createItemStore(database.db);
    await store.replaceAll("1.60.1.1010", [item(1, "Made-up High Test Fishing Line")]);

    const found = await store.search("fishing line", 25);

    expect(found.map((match) => match.name)).toEqual(["Made-up High Test Fishing Line"]);
  });
});
