import { type Database, gameBuilds, items, recipeReagents, recipes } from "@nozdormu/db";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { ItemRecord } from "./item-sparse.ts";
import type { RecipeRecord } from "./recipes.ts";

// What a recipe suggestion shows.
export type RecipeSummary = Pick<RecipeRecord, "spellId" | "name" | "professions">;

// Everything imported from one client build.
export interface GameBuild {
  readonly version: string;
  readonly items: readonly ItemRecord[];
  readonly recipes: readonly RecipeRecord[];
}

export interface GameDataStore {
  // The build the stored data comes from, if any has been imported.
  readonly importedVersion: () => Promise<string | undefined>;
  // Replaces all the stored data with this build's, in one transaction.
  readonly replaceBuild: (build: GameBuild) => Promise<void>;
  readonly getItem: (id: number) => Promise<ItemRecord | undefined>;
  // Items whose name contains the text: names starting with it first, then shorter names.
  readonly searchItems: (text: string, limit: number) => Promise<ItemRecord[]>;
  // The names of those of these items that exist, by ID.
  readonly itemNames: (ids: readonly number[]) => Promise<Map<number, string>>;
  readonly getRecipe: (spellId: number) => Promise<RecipeRecord | undefined>;
  // Recipes whose name, or whose item's name, contains the text: names starting with it first,
  // then shorter names.
  readonly searchRecipes: (text: string, limit: number) => Promise<RecipeSummary[]>;
}

// Postgres allows 65,535 parameters per statement; at most eight per row keeps this well under.
const insertBatchSize = 1000;

async function insertInBatches<Row>(
  rows: readonly Row[],
  insert: (batch: Row[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += insertBatchSize) {
    await insert(rows.slice(start, start + insertBatchSize));
  }
}

// Names of items and recipes Blizzard left in the data but players never see: "DEPRECATED",
// "(Test)", "[PH]" placeholders, "Unused" and "(OLD)". Hidden from searches; still found by ID.
// "High Test" is a real fishing line, the only real item among the 19,224 in 1.60.1.70009 with
// "test" in its name.
const unusedName = String.raw`deprecated|(?<!high )\mtest\M|\[ph\]|placeholder|\munused\M|\(old\)`;

// So "%" and "_" in what someone types match themselves, not any characters.
function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/g, (character) => `\\${character}`);
}

export function createGameDataStore(db: Database): GameDataStore {
  return {
    importedVersion: async () => {
      const [build] = await db
        .select({ version: gameBuilds.version })
        .from(gameBuilds)
        .orderBy(desc(gameBuilds.importedAt))
        .limit(1);
      return build?.version;
    },
    replaceBuild: async (build) => {
      await db.transaction(async (tx) => {
        // Deleting a recipe deletes its reagents too.
        await tx.delete(recipes);
        await tx.delete(items);
        await insertInBatches(build.items, (batch) => tx.insert(items).values(batch));
        await insertInBatches(
          build.recipes.map(({ reagents: _reagents, ...recipe }) => ({
            ...recipe,
            professions: [...recipe.professions],
            taughtBy: [...recipe.taughtBy],
          })),
          (batch) => tx.insert(recipes).values(batch),
        );
        await insertInBatches(
          build.recipes.flatMap((recipe) =>
            recipe.reagents.map((reagent, position) => ({
              spellId: recipe.spellId,
              position,
              ...reagent,
            })),
          ),
          (batch) => tx.insert(recipeReagents).values(batch),
        );
        await tx
          .insert(gameBuilds)
          .values({ version: build.version, itemCount: build.items.length })
          .onConflictDoUpdate({
            target: gameBuilds.version,
            set: { itemCount: build.items.length, importedAt: sql`now()` },
          });
      });
    },
    getItem: async (id) => {
      const [found] = await db.select().from(items).where(eq(items.id, id));
      return found;
    },
    searchItems: async (text, limit) => {
      const escaped = escapeLike(text);
      return db
        .select()
        .from(items)
        .where(and(ilike(items.name, `%${escaped}%`), sql`${items.name} !~* ${unusedName}`))
        .orderBy(
          sql`case when ${items.name} ilike ${`${escaped}%`} then 0 else 1 end`,
          sql`length(${items.name})`,
          asc(items.name),
        )
        .limit(limit);
    },
    itemNames: async (ids) => {
      const found = await db
        .select({ id: items.id, name: items.name })
        .from(items)
        .where(inArray(items.id, [...ids]));
      return new Map(found.map((row) => [row.id, row.name]));
    },
    getRecipe: async (spellId) => {
      const [found] = await db.select().from(recipes).where(eq(recipes.spellId, spellId));
      if (found === undefined) {
        return undefined;
      }
      const reagents = await db
        .select({ itemId: recipeReagents.itemId, count: recipeReagents.count })
        .from(recipeReagents)
        .where(eq(recipeReagents.spellId, spellId))
        .orderBy(asc(recipeReagents.position));
      return { ...found, reagents };
    },
    searchRecipes: async (text, limit) => {
      const escaped = escapeLike(text);
      return db
        .select({ spellId: recipes.spellId, name: recipes.name, professions: recipes.professions })
        .from(recipes)
        .leftJoin(items, eq(items.id, recipes.itemId))
        .where(
          and(
            or(ilike(recipes.name, `%${escaped}%`), ilike(items.name, `%${escaped}%`)),
            sql`${recipes.name} !~* ${unusedName}`,
          ),
        )
        .orderBy(
          sql`case when ${recipes.name} ilike ${`${escaped}%`} or ${items.name} ilike ${`${escaped}%`} then 0 else 1 end`,
          sql`length(${recipes.name})`,
          asc(recipes.name),
        )
        .limit(limit);
    },
  };
}
