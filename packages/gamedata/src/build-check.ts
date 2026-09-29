import type { Logger, ScheduledJob } from "@nozdormu/core";
import { parseItemSparse } from "./item-sparse.ts";
import type { ItemStore } from "./item-store.ts";

// Where the game data comes from: wago.tools in production.
export interface GameDataSource {
  // The newest build of the product we follow.
  readonly latestBuild: () => Promise<string>;
  // The ItemSparse table of a build, as CSV.
  readonly itemSparse: (version: string) => Promise<string>;
}

export interface BuildCheckDeps {
  readonly source: GameDataSource;
  readonly items: ItemStore;
  readonly logger: Pick<Logger, "info">;
  // An import with fewer items than this is treated as a failed download. Forever has about 19,000.
  readonly minimumItems?: number;
}

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
    if (latest === (await deps.items.importedVersion())) {
      return;
    }
    const startedAt = performance.now();
    const records = parseItemSparse(await deps.source.itemSparse(latest));
    const minimumItems = deps.minimumItems ?? 1000;
    if (records.length < minimumItems) {
      throw new Error(
        `wago.tools gave only ${String(records.length)} items for build ${latest}, so the stored items were kept.`,
      );
    }
    await deps.items.replaceAll(latest, records);
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
