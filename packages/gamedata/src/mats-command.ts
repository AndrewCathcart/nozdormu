import { type CommandReply, escapeMarkdown, type SlashCommand } from "@nozdormu/core";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import type { GameDataStore } from "./game-data-store.ts";
import { listMaterials, type Materials } from "./materials.ts";
import {
  findRecipe,
  itemNamer,
  recipeNotFound,
  suggestRecipes,
  wowheadLink,
} from "./recipe-lookup.ts";
import type { Reagent, RecipeRecord } from "./recipes.ts";

const maxTimes = 100;

function describeMaterials(
  recipe: RecipeRecord,
  times: number,
  materials: Materials,
  itemNames: ReadonlyMap<number, string>,
): string {
  const itemName = itemNamer(itemNames);
  const lines = (amounts: readonly Reagent[]): string[] =>
    amounts.map(({ itemId, count }) => `- ${String(count)} × ${itemName(itemId)}`);
  const goal =
    recipe.result.kind === "item"
      ? `${String(times * recipe.result.count)} × ${itemName(recipe.result.itemId)}`
      : escapeMarkdown(recipe.name) + (times > 1 ? `, ${String(times)} times` : "");
  return [
    `**Mats for ${goal}** · ${recipe.professions.join(" or ")}`,
    "You'll need:",
    ...lines(materials.raw),
    ...(materials.made.length > 0
      ? ["Made along the way, in order:", ...lines(materials.made)]
      : []),
    wowheadLink(recipe),
    "-# Recipe data from wago.tools. Transmutes and leather grade-ups aren't broken down.",
  ].join("\n");
}

// /mats: everything needed to craft a recipe, with crafted reagents broken down into what they're
// made from, all the way down, and the crafted materials made along the way.
export function createMatsCommand(
  store: Pick<
    GameDataStore,
    "importedBuild" | "getRecipe" | "recipesMaking" | "searchRecipes" | "itemNames"
  >,
): SlashCommand {
  return {
    definition: {
      name: "mats",
      description: "List everything needed to craft a World of Warcraft: Forever recipe",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "recipe",
          description: "Start typing the recipe's or the item's name, then pick it",
          required: true,
          autocomplete: true,
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: "times",
          description: "How many times to craft it (1 if left out)",
          min_value: 1,
          max_value: maxTimes,
        },
      ],
    },
    handle: async (invocation): Promise<CommandReply> => {
      const value = invocation.options.get("recipe");
      const text = typeof value === "string" ? value.trim() : "";
      const recipe = text === "" ? undefined : await findRecipe(store, text);
      if (recipe === undefined) {
        return recipeNotFound(store);
      }
      // Discord enforces the option's limits; anything else counts as once.
      const timesValue = invocation.options.get("times");
      const times =
        typeof timesValue === "number" &&
        Number.isInteger(timesValue) &&
        timesValue >= 1 &&
        timesValue <= maxTimes
          ? timesValue
          : 1;
      const materials = await listMaterials(recipe, times, store);
      const itemNames = await store.itemNames([
        ...(recipe.result.kind === "item" ? [recipe.result.itemId] : []),
        ...materials.raw.map((amount) => amount.itemId),
        ...materials.made.map((amount) => amount.itemId),
      ]);
      return {
        content: describeMaterials(recipe, times, materials, itemNames),
        allowed_mentions: { parse: [] },
      };
    },
    autocomplete: (query) => suggestRecipes(store, query.value),
  };
}
