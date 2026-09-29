import type { Logger, ScheduledJob } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import type { DungeonStore } from "./dungeon-store.ts";
import { createDungeonFeature, type DungeonFeatureDeps } from "./feature.ts";
import type { Dungeon, ScannedItem, SpyglassData, SpyglassReader } from "./spyglass.ts";

// Made-up dungeons, each with one boss.
function dungeons(count: number): Dungeon[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Made-up Dungeon ${String(index + 1)}`,
    minLevel: 10 + index,
    maxLevel: 15 + index,
    requiredLevel: undefined,
    bosses: [{ name: `Made-up Boss ${String(index + 1)}`, loot: [] }],
    quests: [],
  }));
}

// Made-up scanned items, without stats.
function items(count: number): ScannedItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 280_000 + index,
    name: `Made-up Item ${String(index + 1)}`,
    quality: 2,
    itemLevel: 20,
    requiredLevel: 15,
    itemClass: 4,
    itemSubclass: 1,
    slot: "INVTYPE_CHEST",
    stats: [],
  }));
}

function synced(dungeonCount: number, itemCount: number): SpyglassData {
  return { build: "1.60.1.69913", dungeons: dungeons(dungeonCount), items: items(itemCount) };
}

function createDeps(found: SpyglassData) {
  return {
    readSpyglass: vi.fn<SpyglassReader>().mockResolvedValue(found),
    store: {
      replaceAll: vi.fn<DungeonStore["replaceAll"]>().mockResolvedValue(undefined),
      get: vi.fn<DungeonStore["get"]>().mockResolvedValue(undefined),
      list: vi.fn<DungeonStore["list"]>().mockResolvedValue([]),
      loadedBuild: vi.fn<DungeonStore["loadedBuild"]>().mockResolvedValue(undefined),
    } satisfies DungeonStore,
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  } satisfies DungeonFeatureDeps;
}

function syncJob(deps: DungeonFeatureDeps): ScheduledJob {
  const [job] = createDungeonFeature(deps).jobs ?? [];
  if (job === undefined) {
    throw new Error("The feature has no job.");
  }
  return job;
}

describe("createDungeonFeature", () => {
  it("syncs the dungeons every 6 hours", () => {
    expect(syncJob(createDeps(synced(0, 0)))).toMatchObject({
      name: "dungeons.sync",
      intervalMs: 6 * 60 * 60_000,
    });
  });

  it("replaces the stored dungeons and items with Spyglass's, and logs how many", async () => {
    const deps = createDeps(synced(25, 10_000));

    await syncJob(deps).run();

    expect(deps.store.replaceAll).toHaveBeenCalledExactlyOnceWith(synced(25, 10_000));
    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "dungeons.synced", build: "1.60.1.69913", dungeons: 25, bosses: 25, items: 10_000 },
      "Synced Forever's dungeons and items from Spyglass",
    );
  });

  it("keeps the stored data when Spyglass lists far fewer dungeons than Forever has", async () => {
    const deps = createDeps(synced(19, 10_000));

    await expect(syncJob(deps).run()).rejects.toThrow(
      new Error("Spyglass listed only 19 Forever dungeons, so the stored data was kept."),
    );
    expect(deps.store.replaceAll).not.toHaveBeenCalled();
  });

  it("keeps the stored data when Spyglass lists far fewer items than it has scanned", async () => {
    const deps = createDeps(synced(25, 9_999));

    await expect(syncJob(deps).run()).rejects.toThrow(
      new Error("Spyglass listed only 9999 scanned items, so the stored data was kept."),
    );
    expect(deps.store.replaceAll).not.toHaveBeenCalled();
  });
});
