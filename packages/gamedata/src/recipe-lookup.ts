// Finding a recipe from what someone typed or picked, shared by /recipe and /mats.
import { type AutocompleteChoice, type CommandReply, maxAutocompleteChoices } from "@nozdormu/core";
import { MessageFlags } from "discord-api-types/v10";
import type { GameDataStore } from "./game-data-store.ts";
import { notLoaded, parseId, toChoices } from "./lookup.ts";
import type { RecipeRecord } from "./recipes.ts";

type RecipeLookupStore = Pick<GameDataStore, "importedBuild" | "getRecipe" | "searchRecipes">;

// Builds imported before recipes were (import format 1) have none until the next build check.
const firstFormatWithRecipes = 2;

// A picked suggestion sends the recipe's spell ID; typed text finds the best match.
export async function findRecipe(
  store: RecipeLookupStore,
  value: string,
): Promise<RecipeRecord | undefined> {
  const id = parseId(value);
  if (id !== undefined) {
    return store.getRecipe(id);
  }
  const [best] = await store.searchRecipes(value, 1);
  return best === undefined ? undefined : store.getRecipe(best.spellId);
}

// The private reply when no recipe was found: the data isn't loaded yet, or there's no such recipe.
export async function recipeNotFound(store: RecipeLookupStore): Promise<CommandReply> {
  const imported = await store.importedBuild();
  return imported === undefined || imported.format < firstFormatWithRecipes
    ? notLoaded("recipe")
    : {
        content:
          "I couldn't find that recipe. Start typing its name and pick one of the suggestions.",
        flags: MessageFlags.Ephemeral,
      };
}

// Recipes whose name, or whose item's name, contains the text, labelled with their profession and
// the skill level where they turn yellow.
export async function suggestRecipes(
  store: RecipeLookupStore,
  value: string,
): Promise<AutocompleteChoice[]> {
  const text = value.trim();
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
}
