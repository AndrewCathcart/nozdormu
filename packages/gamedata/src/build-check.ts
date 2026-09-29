import type { Logger, ScheduledJob } from "@nozdormu/core";
import { type ClassSpellTable, parseClassSpells } from "./class-spells.ts";
import type { GameBuild, GameDataStore } from "./game-data-store.ts";
import { parseItemSparse } from "./item-sparse.ts";
import { parseRecipes, type RecipeTable } from "./recipes.ts";

// The client tables we import.
export type GameTable = "ItemSparse" | RecipeTable | ClassSpellTable;

// Where the game data comes from: wago.tools in production.
export interface GameDataSource {
  // The newest build of the product we follow.
  readonly latestBuild: () => Promise<string>;
  // A table of a build, as CSV.
  readonly table: (name: GameTable, version: string) => Promise<string>;
}

export interface BuildCheckDeps {
  readonly source: GameDataSource;
  readonly store: Pick<GameDataStore, "importedBuild" | "replaceBuild">;
  readonly logger: Pick<Logger, "info">;
}

// Which version of the import this code does. Bump it when an import starts storing something new,
// and the next check imports the current build again, even if it was imported before.
// 2 added recipes, 3 enchants, and 4 class trainer spells.
export const importFormat = 4;

// A build with fewer items, recipes or class spells than this is treated as a failed download.
// Forever has about 19,000 items, 2,300 recipes and 1,340 class trainer spells.
const minimumItems = 1000;
const minimumRecipes = 1000;
const minimumClassSpells = 500;

// Forever's client builds are 1.60 and up. The product we follow has carried other games' betas
// before, so anything else is skipped.
function isForeverBuild(version: string): boolean {
  const minor = /^1\.(\d+)\./.exec(version)?.[1];
  return minor !== undefined && Number.parseInt(minor, 10) >= 60;
}

// Downloads a build's tables one at a time, to go easy on wago.tools, and reads them.
async function download(source: GameDataSource, version: string): Promise<GameBuild> {
  // Every table the import reads has rows, so one with none is a failed download. A table that both
  // recipes and class spells read is downloaded once.
  const downloaded = new Map<GameTable, string>();
  const table = async (name: GameTable): Promise<string> => {
    const cached = downloaded.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const csv = await source.table(name, version);
    if (!csv.trim().includes("\n")) {
      throw new Error(
        `wago.tools gave an empty ${name} table for build ${version}, so the stored game data was kept.`,
      );
    }
    downloaded.set(name, csv);
    return csv;
  };
  const items = parseItemSparse(await table("ItemSparse"));
  const itemIds = new Set(items.map((item) => item.id));
  const allRecipes = parseRecipes({
    SkillLine: await table("SkillLine"),
    SkillLineAbility: await table("SkillLineAbility"),
    SpellName: await table("SpellName"),
    SpellEffect: await table("SpellEffect"),
    SpellReagents: await table("SpellReagents"),
    ItemEffect: await table("ItemEffect"),
    ItemXItemEffect: await table("ItemXItemEffect"),
  });
  // The client still lists recipes, mostly Season of Discovery's, whose items Forever's item table
  // doesn't have. They can't be made, so they're left out, as are recipe items Forever doesn't have.
  const recipes = allRecipes
    .filter((recipe) => recipe.result.kind === "enchant" || itemIds.has(recipe.result.itemId))
    .map((recipe) => ({ ...recipe, taughtBy: recipe.taughtBy.filter((id) => itemIds.has(id)) }));
  const classSpells = parseClassSpells({
    ChrRaces: await table("ChrRaces"),
    CharBaseInfo: await table("CharBaseInfo"),
    SkillLine: await table("SkillLine"),
    SkillRaceClassInfo: await table("SkillRaceClassInfo"),
    SkillLineAbility: await table("SkillLineAbility"),
    SpellName: await table("SpellName"),
    Spell: await table("Spell"),
    SpellLevels: await table("SpellLevels"),
    SpellMisc: await table("SpellMisc"),
    SpellEffect: await table("SpellEffect"),
    Talent: await table("Talent"),
  });
  return { version, format: importFormat, items, recipes, classSpells };
}

function tooFew(count: number, what: "items" | "recipes" | "class spells", version: string): Error {
  return new Error(
    `wago.tools gave only ${String(count)} ${what} for build ${version}, so the stored game data was kept.`,
  );
}

// Hourly: when a new Forever build appears, imports its items, recipes and class trainer spells,
// replacing the previous build's. A failed import leaves the previous build in place, and the next
// check tries again.
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
    const imported = await deps.store.importedBuild();
    // A newer format means a newer version of the bot stored it, while this one is shutting down.
    if (imported?.version === latest && imported.format >= importFormat) {
      return;
    }
    const startedAt = performance.now();
    const build = await download(deps.source, latest);
    if (build.items.length < minimumItems) {
      throw tooFew(build.items.length, "items", latest);
    }
    if (build.recipes.length < minimumRecipes) {
      throw tooFew(build.recipes.length, "recipes", latest);
    }
    if (build.classSpells.length < minimumClassSpells) {
      throw tooFew(build.classSpells.length, "class spells", latest);
    }
    await deps.store.replaceBuild(build);
    deps.logger.info(
      {
        event: "gamedata.imported",
        version: latest,
        items: build.items.length,
        recipes: build.recipes.length,
        classSpells: build.classSpells.length,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "Imported a new game build",
    );
  };
  return { name: "gamedata.check_build", intervalMs: 60 * 60_000, run };
}
