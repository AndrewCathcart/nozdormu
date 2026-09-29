import { type CommandReply, maxAutocompleteChoices, type SlashCommand } from "@nozdormu/core";
import { ApplicationCommandOptionType, MessageFlags } from "discord-api-types/v10";
import type { GameDataStore } from "./game-data-store.ts";
import { escapeMarkdown, notLoaded, parseId, toChoices } from "./lookup.ts";
import type { RecipeRecord } from "./recipes.ts";

// Builds imported before recipes were (import format 1) have none until the next build check.
const firstFormatWithRecipes = 2;

const notFound: CommandReply = {
  content: "I couldn't find that recipe. Start typing its name and pick one of the suggestions.",
  flags: MessageFlags.Ephemeral,
};

function describeRecipe(recipe: RecipeRecord, itemNames: ReadonlyMap<number, string>): string {
  const itemName = (id: number): string =>
    escapeMarkdown(itemNames.get(id) ?? `item ${String(id)}`);
  return [
    `**${escapeMarkdown(recipe.name)}** · ${recipe.professions.join(" or ")}`,
    `Makes ${String(recipe.itemCount)} × ${itemName(recipe.itemId)}`,
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
    `https://www.wowhead.com/forever/item=${String(recipe.itemId)}`,
    "-# Recipe data from wago.tools",
  ].join("\n");
}

// /recipe: suggests recipes as you type the recipe's or the item's name, then shows the one you
// pick: its profession, what it makes, its reagents and skill levels, and where it's taught.
export function createRecipeCommand(
  store: Pick<GameDataStore, "importedBuild" | "getRecipe" | "searchRecipes" | "itemNames">,
): SlashCommand {
  const find = async (value: string): Promise<RecipeRecord | undefined> => {
    const id = parseId(value);
    if (id !== undefined) {
      return store.getRecipe(id);
    }
    const [best] = await store.searchRecipes(value, 1);
    return best === undefined ? undefined : store.getRecipe(best.spellId);
  };

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
      const recipe = text === "" ? undefined : await find(text);
      if (recipe === undefined) {
        const imported = await store.importedBuild();
        return imported === undefined || imported.format < firstFormatWithRecipes
          ? notLoaded("recipe")
          : notFound;
      }
      const itemNames = await store.itemNames([
        recipe.itemId,
        ...recipe.reagents.map((reagent) => reagent.itemId),
        ...recipe.taughtBy,
      ]);
      return { content: describeRecipe(recipe, itemNames), allowed_mentions: { parse: [] } };
    },
    autocomplete: async (query) => {
      const text = query.value.trim();
      if (text === "") {
        return [];
      }
      const found = await store.searchRecipes(text, maxAutocompleteChoices);
      return toChoices(
        found.map((recipe) => ({
          name: recipe.name,
          label:
            recipe.professions.join(" or ") +
            (recipe.skillLevels === undefined
              ? ""
              : `, yellow at ${String(recipe.skillLevels.yellowAt)}`),
          value: String(recipe.spellId),
        })),
      );
    },
  };
}
