import type { Logger } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import { createBuildCheckJob, type GameDataSource } from "./build-check.ts";
import type { ItemRecord } from "./item-sparse.ts";
import type { ItemStore } from "./item-store.ts";

// A made-up ItemSparse export: swords numbered from 1, with IDs from 270001.
function itemSparseCsv(itemCount: number): string {
  const rows = Array.from(
    { length: itemCount },
    (_, index) => `${String(270_001 + index)},Made-up Sword ${String(index + 1)},42,3,37,13`,
  );
  return ["ID,Display_lang,ItemLevel,OverallQualityID,RequiredLevel,InventoryType", ...rows].join(
    "\n",
  );
}

const firstSword: ItemRecord = {
  id: 270_001,
  name: "Made-up Sword 1",
  quality: 3,
  itemLevel: 42,
  requiredLevel: 37,
  inventoryType: 13,
};

// Downloads return 1,000 items, the fewest the job accepts.
function createDeps(latest: string, imported?: string) {
  return {
    source: {
      latestBuild: vi.fn<GameDataSource["latestBuild"]>().mockResolvedValue(latest),
      itemSparse: vi.fn<GameDataSource["itemSparse"]>().mockResolvedValue(itemSparseCsv(1000)),
    },
    items: {
      importedVersion: vi.fn<ItemStore["importedVersion"]>().mockResolvedValue(imported),
      replaceAll: vi.fn<ItemStore["replaceAll"]>().mockResolvedValue(undefined),
      get: vi.fn<ItemStore["get"]>(),
      search: vi.fn<ItemStore["search"]>(),
    },
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  };
}

describe("build check", () => {
  it("imports the items of a new Forever build", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");

    await createBuildCheckJob(deps).run();

    expect(deps.source.itemSparse).toHaveBeenCalledExactlyOnceWith("1.60.1.70009");
    expect(deps.items.replaceAll).toHaveBeenCalledExactlyOnceWith(
      "1.60.1.70009",
      expect.anything(),
    );
    const records = deps.items.replaceAll.mock.calls[0]?.[1];
    expect(records).toHaveLength(1000);
    expect(records?.[0]).toEqual(firstSword);
    expect(records?.[999]?.name).toBe("Made-up Sword 1000");
  });

  it("doesn't import a build it has already imported", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.items.replaceAll).not.toHaveBeenCalled();
  });

  it("ignores a build that isn't Forever's", async () => {
    const deps = createDeps("5.5.0.62071", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.items.replaceAll).not.toHaveBeenCalled();
  });

  it("fails without touching the stored items when the download fails", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");
    deps.source.itemSparse.mockRejectedValue(new Error("wago.tools answered HTTP 503."));

    await expect(createBuildCheckJob(deps).run()).rejects.toThrow("wago.tools answered HTTP 503.");

    expect(deps.items.replaceAll).not.toHaveBeenCalled();
  });

  it("logs each import with its build and item count", async () => {
    const deps = createDeps("1.60.1.70009", undefined);

    await createBuildCheckJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: "gamedata.imported", version: "1.60.1.70009", items: 1000 }),
      "Imported a new game build",
    );
  });

  it("refuses a build with fewer than 1,000 items, keeping the stored ones", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");
    deps.source.itemSparse.mockResolvedValue(itemSparseCsv(999));

    await expect(createBuildCheckJob(deps).run()).rejects.toThrow(
      "wago.tools gave only 999 items for build 1.60.1.70009, so the stored items were kept.",
    );

    expect(deps.items.replaceAll).not.toHaveBeenCalled();
  });

  it("logs a build it skips because it isn't Forever's", async () => {
    const deps = createDeps("5.5.0.62071", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "gamedata.skipped_build", version: "5.5.0.62071" },
      "Skipped a build that isn't Forever's",
    );
  });

  it("accepts later Forever versions such as 1.70", async () => {
    const deps = createDeps("1.70.0.80000", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.items.replaceAll).toHaveBeenCalledExactlyOnceWith(
      "1.70.0.80000",
      expect.anything(),
    );
  });
});
