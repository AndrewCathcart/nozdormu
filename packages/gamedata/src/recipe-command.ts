import { type CommandReply, escapeMarkdown, type SlashCommand } from "@nozdormu/core";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import type { GameDataStore } from "./game-data-store.ts";
import {
  findRecipe,
  itemNamer,
  recipeNotFound,
  suggestRecipes,
  wowheadLink,
} from "./recipe-lookup.ts";
import type { RecipeRecord } from "./recipes.ts";

function describeRecipe(recipe: RecipeRecord, itemNames: ReadonlyMap<number, string>): string {
  const itemName = itemNamer(itemNames);
  return [
    `**${escapeMarkdown(recipe.name)}** · ${recipe.professions.join(" or ")}`,
    ...(recipe.result.kind === "item"
      ? [`Makes ${String(recipe.result.count)} × ${itemName(recipe.result.itemId)}`]
      : []),
    ...(recipe.reagents.length > 0
      ? [
          `Reagents: ${recipe.reagents.map((reagent) => `${String(reagent.count)} × ${itemName(reagent.itemId)}`).join(", ")}`,
        ]
      : []),
    ...(recipe.skillLevels === undefined
      ? []
      : [
          `Turns yellow at ${String(recipe.skillLevels.yellowAt)} and grey at ${String(recipe.skillLevels.greyAt)}`,
        ]),
    ...(recipe.taughtBy.length > 0
      ? [`Taught by ${recipe.taughtBy.map(itemName).join(" or ")}`]
      : []),
    wowheadLink(recipe),
    "-# Recipe data from wago.tools",
  ].join("\n");
}

// /recipe: suggests recipes as you type the recipe's or the item's name, then shows the one you
// pick: its profession, what it makes, its reagents and skill levels, and where it's taught.
export function createRecipeCommand(
  store: Pick<GameDataStore, "importedBuild" | "getRecipe" | "searchRecipes" | "itemNames">,
): SlashCommand {
  return {
    definition: {
      name: "recipe",
      description: "Look up a World of Warcraft: Forever crafting recipe",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "name",
          description: "Start typing the recipe's or the item's name, then pick it",
          required: true,
          autocomplete: true,
        },
      ],
    },
    handle: async (invocation): Promise<CommandReply> => {
      const value = invocation.options.get("name");
      const text = typeof value === "string" ? value.trim() : "";
      const recipe = text === "" ? undefined : await findRecipe(store, text);
      if (recipe === undefined) {
        return recipeNotFound(store);
      }
      const itemNames = await store.itemNames([
        ...(recipe.result.kind === "item" ? [recipe.result.itemId] : []),
        ...recipe.reagents.map((reagent) => reagent.itemId),
        ...recipe.taughtBy,
      ]);
      return { content: describeRecipe(recipe, itemNames), allowed_mentions: { parse: [] } };
    },
    autocomplete: (query) => suggestRecipes(store, query.value),
  };
}
