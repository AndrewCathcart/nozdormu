import type { Feature, Logger } from "@nozdormu/core";
import { createDungeonCommand } from "./dungeon-command.ts";
import type { DungeonStore } from "./dungeon-store.ts";
import type { SpyglassReader } from "./spyglass.ts";

export interface DungeonFeatureDeps {
  readonly readSpyglass: SpyglassReader;
  readonly store: DungeonStore;
  readonly logger: Pick<Logger, "info" | "warn">;
}

// Spyglass lists 29 Forever dungeons and wings, and about 23,000 scanned items. A read with far
// fewer has gone wrong, and would otherwise replace the good data.
const minDungeons = 20;
const minItems = 10_000;

// /dungeon, and the sync that keeps its data in step with Spyglass every 6 hours.
export function createDungeonFeature(deps: DungeonFeatureDeps): Feature {
  const sync = async (): Promise<void> => {
    const synced = await deps.readSpyglass();
    const { build, dungeons, items, missingFiles } = synced;
    if (missingFiles.length > 0) {
      deps.logger.warn(
        { event: "dungeons.files_missing", files: missingFiles },
        "Skipped files Spyglass's listing named but GitHub doesn't have",
      );
    }
    if (dungeons.length < minDungeons) {
      throw new Error(
        `Spyglass listed only ${String(dungeons.length)} Forever dungeons, so the stored data was kept.`,
      );
    }
    if (items.length < minItems) {
      throw new Error(
        `Spyglass listed only ${String(items.length)} scanned items, so the stored data was kept.`,
      );
    }
    await deps.store.replaceAll(synced);
    deps.logger.info(
      {
        event: "dungeons.synced",
        build,
        dungeons: dungeons.length,
        bosses: dungeons.reduce((total, dungeon) => total + dungeon.bosses.length, 0),
        quests: dungeons.reduce((total, dungeon) => total + dungeon.quests.length, 0),
        items: items.length,
      },
      "Synced Forever's dungeons and items from Spyglass",
    );
  };

  return {
    commands: [createDungeonCommand(deps.store)],
    jobs: [{ name: "dungeons.sync", intervalMs: 6 * 60 * 60_000, run: sync }],
  };
}
