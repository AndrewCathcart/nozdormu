import type { Logger } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import { createBuildCheckJob, type GameDataSource } from "./build-check.ts";
import type { ItemRecord } from "./item-sparse.ts";
import type { GameDataStore } from "./game-data-store.ts";

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
      table: vi.fn<GameDataSource["table"]>().mockResolvedValue(itemSparseCsv(1000)),
    },
    store: {
      importedVersion: vi.fn<GameDataStore["importedVersion"]>().mockResolvedValue(imported),
      replaceBuild: vi.fn<GameDataStore["replaceBuild"]>().mockResolvedValue(undefined),
      getItem: vi.fn<GameDataStore["getItem"]>(),
      searchItems: vi.fn<GameDataStore["searchItems"]>(),
    },
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  };
}

describe("build check", () => {
  it("imports the items of a new Forever build", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");

    await createBuildCheckJob(deps).run();

    expect(deps.source.table).toHaveBeenCalledExactlyOnceWith("ItemSparse", "1.60.1.70009");
    expect(deps.store.replaceBuild).toHaveBeenCalledOnce();
    const build = deps.store.replaceBuild.mock.calls[0]?.[0];
    expect(build?.version).toBe("1.60.1.70009");
    const records = build?.items;
    expect(records).toHaveLength(1000);
    expect(records?.[0]).toEqual(firstSword);
    expect(records?.[999]?.name).toBe("Made-up Sword 1000");
  });

  it("doesn't import a build it has already imported", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
  });

  it("ignores a build that isn't Forever's", async () => {
    const deps = createDeps("5.5.0.62071", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
  });

  it("fails without touching the stored items when the download fails", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");
    deps.source.table.mockRejectedValue(new Error("wago.tools answered HTTP 503."));

    await expect(createBuildCheckJob(deps).run()).rejects.toThrow("wago.tools answered HTTP 503.");

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
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
    deps.source.table.mockResolvedValue(itemSparseCsv(999));

    await expect(createBuildCheckJob(deps).run()).rejects.toThrow(
      "wago.tools gave only 999 items for build 1.60.1.70009, so the stored items were kept.",
    );

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
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

    expect(deps.store.replaceBuild.mock.calls[0]?.[0].version).toBe("1.70.0.80000");
  });
});
