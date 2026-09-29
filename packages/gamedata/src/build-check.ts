import type { Logger, ScheduledJob } from "@nozdormu/core";
import { parseItemSparse } from "./item-sparse.ts";
import type { GameDataStore } from "./game-data-store.ts";

// The client tables we import.
export type GameTable = "ItemSparse";

// Where the game data comes from: wago.tools in production.
export interface GameDataSource {
  // The newest build of the product we follow.
  readonly latestBuild: () => Promise<string>;
  // A table of a build, as CSV.
  readonly table: (name: GameTable, version: string) => Promise<string>;
}

export interface BuildCheckDeps {
  readonly source: GameDataSource;
  readonly store: Pick<GameDataStore, "importedVersion" | "replaceBuild">;
  readonly logger: Pick<Logger, "info">;
}

// A download with fewer items than this is treated as a failed one. Forever has about 19,000.
const minimumItems = 1000;

// Forever's client builds are 1.60 and up. The product we follow has carried other games' betas
// before, so anything else is skipped.
function isForeverBuild(version: string): boolean {
  const minor = /^1\.(\d+)\./.exec(version)?.[1];
  return minor !== undefined && Number.parseInt(minor, 10) >= 60;
}

// Hourly: when a new Forever build appears, imports its items, replacing the previous build's. A
// failed import leaves the previous build in place, and the next check tries again.
export function createBuildCheckJob(deps: BuildCheckDeps): ScheduledJob {
  const run = async (): Promise<void> => {
    const latest = await deps.source.latestBuild();
    if (!isForeverBuild(latest)) {
      // Logged every hour: if Forever moves to another product, the constant needs changing.
      deps.logger.info(
        { event: "gamedata.skipped_build", version: latest },
        "Skipped a build that isn't Forever's",
      );
      return;
    }
    if (latest === (await deps.store.importedVersion())) {
      return;
    }
    const startedAt = performance.now();
    const records = parseItemSparse(await deps.source.table("ItemSparse", latest));
    if (records.length < minimumItems) {
      throw new Error(
        `wago.tools gave only ${String(records.length)} items for build ${latest}, so the stored items were kept.`,
      );
    }
    await deps.store.replaceBuild({ version: latest, items: records, recipes: [] });
    deps.logger.info(
      {
        event: "gamedata.imported",
        version: latest,
        items: records.length,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "Imported a new game build",
    );
  };
  return { name: "gamedata.check_build", intervalMs: 60 * 60_000, run };
}
