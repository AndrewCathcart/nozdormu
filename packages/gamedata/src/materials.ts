import type { GameDataStore } from "./game-data-store.ts";
import type { Reagent, RecipeRecord } from "./recipes.ts";

export interface Materials {
  // What to gather or buy, in the order the recipe first needs it.
  readonly raw: readonly Reagent[];
  // What to craft on the way, each before anything that needs it, with how many it makes.
  readonly made: readonly Reagent[];
}

interface Craft {
  readonly itemId: number;
  readonly recipe: RecipeRecord;
}

// A recipe that turns one gathered material into another, whose result is usually gathered too: a
// transmute (essences, Arcanite), or a leatherworker's grade-up from one leather (Light Leather from
// scraps, and so on up to Rugged Leather).
function isConversion(recipe: RecipeRecord): boolean {
  return (
    recipe.name.startsWith("Transmute") ||
    (recipe.professions.includes("Leatherworking") &&
      recipe.name.endsWith(" Leather") &&
      recipe.reagents.length === 1)
  );
}

// The recipe to break each craftable reagent down with, found a level at a time.
async function recipesToBreakDown(
  root: RecipeRecord,
  store: Pick<GameDataStore, "recipesMaking">,
): Promise<Map<number, RecipeRecord>> {
  const chosen = new Map<number, RecipeRecord>();
  const looked = new Set<number>();
  let next = root.reagents.map((reagent) => reagent.itemId);
  while (next.length > 0) {
    const itemIds = [...new Set(next)].filter((itemId) => !looked.has(itemId));
    next = [];
    if (itemIds.length === 0) {
      break;
    }
    for (const itemId of itemIds) {
      looked.add(itemId);
    }
    const found = await store.recipesMaking(itemIds);
    for (const itemId of itemIds) {
      // An item more than one recipe makes isn't broken down, rather than guess which one.
      const [maker, ...others] = found.filter(
        (recipe) =>
          recipe.result.kind === "item" && recipe.result.itemId === itemId && !isConversion(recipe),
      );
      if (maker !== undefined && others.length === 0) {
        chosen.set(itemId, maker);
        next.push(...maker.reagents.map((reagent) => reagent.itemId));
      }
    }
  }
  return chosen;
}

// Walks the breakdown depth first: the crafts in an order that makes each before anything that
// needs it, and every item in the order the recipe first needs it. An item whose breakdown would
// need itself isn't broken down: its recipe is set aside and the walk starts again.
function walk(
  root: RecipeRecord,
  recipes: ReadonlyMap<number, RecipeRecord>,
): { crafts: Craft[]; seen: number[] } {
  const chosen = new Map(recipes);
  for (;;) {
    const crafts: Craft[] = [];
    const seen: number[] = [];
    const visiting = new Set<number>();
    let loop: number | undefined;
    const visit = (recipe: RecipeRecord): void => {
      for (const { itemId } of recipe.reagents) {
        if (!seen.includes(itemId)) {
          seen.push(itemId);
        }
        const maker = chosen.get(itemId);
        if (maker === undefined || crafts.some((craft) => craft.itemId === itemId)) {
          continue;
        }
        if (visiting.has(itemId)) {
          loop ??= itemId;
          continue;
        }
        visiting.add(itemId);
        visit(maker);
        visiting.delete(itemId);
        crafts.push({ itemId, recipe: maker });
      }
    };
    visit(root);
    if (loop === undefined) {
      return { crafts, seen };
    }
    chosen.delete(loop);
  }
}

// Everything needed to craft a recipe a number of times, with each craftable reagent broken down
// into what it's made from. Amounts are added up across the whole breakdown before working out how
// often to craft each thing, so a recipe that makes several at once isn't crafted more than needed.
export async function listMaterials(
  root: RecipeRecord,
  times: number,
  store: Pick<GameDataStore, "recipesMaking">,
): Promise<Materials> {
  const chosen = await recipesToBreakDown(root, store);
  const { crafts, seen } = walk(root, chosen);

  const needed = new Map<number, number>();
  const need = (recipe: RecipeRecord, crafted: number): void => {
    for (const { itemId, count } of recipe.reagents) {
      needed.set(itemId, (needed.get(itemId) ?? 0) + count * crafted);
    }
  };
  need(root, times);
  const made: Reagent[] = [];
  // Everything that needs a craft comes after it in the walk, so going backwards counts all of it.
  for (const { itemId, recipe } of crafts.toReversed()) {
    const perCraft = recipe.result.kind === "item" ? recipe.result.count : 1;
    const crafted = Math.ceil((needed.get(itemId) ?? 0) / perCraft);
    need(recipe, crafted);
    made.unshift({ itemId, count: crafted * perCraft });
  }
  return {
    raw: seen
      .filter((itemId) => !crafts.some((craft) => craft.itemId === itemId))
      .map((itemId) => ({ itemId, count: needed.get(itemId) ?? 0 })),
    made,
  };
}
