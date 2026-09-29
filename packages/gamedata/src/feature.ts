import type { Feature, Logger } from "@nozdormu/core";
import { createBuildCheckJob, type GameDataSource } from "./build-check.ts";
import { createItemCommand } from "./item-command.ts";
import type { GameDataStore } from "./game-data-store.ts";

export interface GameDataFeatureDeps {
  readonly store: GameDataStore;
  readonly source: GameDataSource;
  readonly logger: Pick<Logger, "info">;
}

// The game database: /item, and the hourly import of each new Forever build's items.
export function createGameDataFeature(deps: GameDataFeatureDeps): Feature {
  return {
    commands: [createItemCommand(deps.store)],
    jobs: [createBuildCheckJob(deps)],
  };
}
