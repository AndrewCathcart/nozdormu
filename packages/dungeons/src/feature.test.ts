import type { Logger, ScheduledJob } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import type { DungeonStore } from "./dungeon-store.ts";
import { createDungeonFeature, type DungeonFeatureDeps } from "./feature.ts";
import type { Dungeon, SpyglassReader } from "./spyglass.ts";

// Made-up dungeons, each with one boss.
function dungeons(count: number): Dungeon[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Made-up Dungeon ${String(index + 1)}`,
    minLevel: 10 + index,
    maxLevel: 15 + index,
    requiredLevel: undefined,
    bosses: [{ name: `Made-up Boss ${String(index + 1)}`, loot: [] }],
  }));
}

function createDeps(found: readonly Dungeon[]) {
  return {
    readSpyglass: vi
      .fn<SpyglassReader>()
      .mockResolvedValue({ build: "1.60.1.69913", dungeons: found }),
    store: {
      replaceAll: vi.fn<DungeonStore["replaceAll"]>().mockResolvedValue(undefined),
      get: vi.fn<DungeonStore["get"]>().mockResolvedValue(undefined),
      search: vi.fn<DungeonStore["search"]>().mockResolvedValue([]),
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
    expect(syncJob(createDeps([]))).toMatchObject({
      name: "dungeons.sync",
      intervalMs: 6 * 60 * 60_000,
    });
  });

  it("replaces the stored dungeons with Spyglass's, and logs how many", async () => {
    const deps = createDeps(dungeons(25));

    await syncJob(deps).run();

    expect(deps.store.replaceAll).toHaveBeenCalledExactlyOnceWith("1.60.1.69913", dungeons(25));
    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "dungeons.synced", build: "1.60.1.69913", dungeons: 25, bosses: 25 },
      "Synced Forever's dungeons from Spyglass",
    );
  });

  it("keeps the stored dungeons when Spyglass lists far fewer than Forever has", async () => {
    const deps = createDeps(dungeons(19));

    await expect(syncJob(deps).run()).rejects.toThrow(
      new Error("Spyglass listed only 19 Forever dungeons, so the stored ones were kept."),
    );
    expect(deps.store.replaceAll).not.toHaveBeenCalled();
  });
});
