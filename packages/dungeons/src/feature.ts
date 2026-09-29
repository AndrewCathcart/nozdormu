import type { Feature, Logger } from "@nozdormu/core";
import { createDungeonCommand } from "./dungeon-command.ts";
import type { DungeonStore } from "./dungeon-store.ts";
import type { SpyglassReader } from "./spyglass.ts";

export interface DungeonFeatureDeps {
  readonly readSpyglass: SpyglassReader;
  readonly store: DungeonStore;
  readonly logger: Pick<Logger, "info">;
}

// Spyglass lists 29 Forever dungeons and wings. A read with far fewer has gone wrong, and would
// otherwise replace the good ones.
const minDungeons = 20;

// /dungeon, and the sync that keeps its data in step with Spyglass every 6 hours.
export function createDungeonFeature(deps: DungeonFeatureDeps): Feature {
  const sync = async (): Promise<void> => {
    const { build, dungeons } = await deps.readSpyglass();
    if (dungeons.length < minDungeons) {
      throw new Error(
        `Spyglass listed only ${String(dungeons.length)} Forever dungeons, so the stored ones were kept.`,
      );
    }
    await deps.store.replaceAll(build, dungeons);
    deps.logger.info(
      {
        event: "dungeons.synced",
        build,
        dungeons: dungeons.length,
        bosses: dungeons.reduce((total, dungeon) => total + dungeon.bosses.length, 0),
      },
      "Synced Forever's dungeons from Spyglass",
    );
  };

  return {
    commands: [createDungeonCommand(deps.store)],
    jobs: [{ name: "dungeons.sync", intervalMs: 6 * 60 * 60_000, run: sync }],
  };
}
