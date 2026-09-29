import { z } from "zod";

export interface LootItem {
  readonly itemId: number;
  readonly name: string;
}

export interface Boss {
  readonly name: string;
  // The loot seen from it so far, which may not be all of it.
  readonly loot: readonly LootItem[];
}

export interface Dungeon {
  readonly name: string;
  readonly minLevel: number;
  readonly maxLevel: number;
  // The level needed to enter, where known.
  readonly requiredLevel: number | undefined;
  // In the game's encounter order, which isn't always the order they're fought in.
  readonly bosses: readonly Boss[];
}

// One of an item's stats as the game names it, such as "STAMINA" or "RESISTANCE0_NAME" (armour).
export interface ItemStat {
  readonly stat: string;
  readonly value: number;
}

// An item as scanned in the game, with its exact stats.
export interface ScannedItem {
  readonly id: number;
  readonly name: string;
  readonly quality: number;
  readonly itemLevel: number;
  readonly requiredLevel: number;
  // The game's IDs for what kind of item it is, such as 4 (armour) and 2 (leather).
  readonly itemClass: number;
  readonly itemSubclass: number;
  // The game's name for where it's worn, such as "INVTYPE_NECK".
  readonly slot: string;
  readonly stats: readonly ItemStat[];
}

export interface SpyglassData {
  // The game build the data was scanned in.
  readonly build: string;
  readonly dungeons: readonly Dungeon[];
  readonly items: readonly ScannedItem[];
}

export type SpyglassReader = () => Promise<SpyglassData>;

export interface SpyglassReaderOptions {
  readonly fetch: typeof fetch;
}

const repository = "Karl-HeinzSchneider/WoW-Spyglass";
const dataPath = ".contribute/data";

const config = z.object({ build: z.string() });

const listing = z.object({ files: z.array(z.object({ name: z.string() })) });

// A dungeon file's path in the listing, such as "/.contribute/data/dungeons/deadmines.json", and an
// item file's, such as "/.contribute/data/items/items_270000.json".
const dungeonFilePath = /^\/\.contribute\/data\/(dungeons\/[a-z0-9_]+\.json)$/;
const itemFilePath = /^\/\.contribute\/data\/(items\/items_\d+\.json)$/;

const dungeonFile = z.object({
  name: z.string(),
  minLevel: z.int().optional(),
  maxLevel: z.int().optional(),
  requiredLevel: z.int().optional(),
  encounters: z.array(
    z.object({
      name: z.string(),
      loot: z.array(z.object({ item: z.int().positive(), name: z.string() })),
    }),
  ),
});

// Items by ID. An item without an English name is left out.
const itemFile = z.record(
  z.string().regex(/^[1-9][0-9]*$/),
  z.object({
    names: z.object({ enUS: z.string().optional() }),
    quality: z.int(),
    itemLevel: z.int(),
    reqLevel: z.int(),
    classID: z.int(),
    subclassID: z.int(),
    slot: z.string(),
    stats: z.record(z.string(), z.number()).optional(),
  }),
);

// Reads Forever's dungeons and items from Spyglass, an MIT-licensed addon whose maintainers scan the
// game and publish what they find on GitHub: its config names the build, each dungeon has its own
// file, and items come in files of up to 10,000 IDs. jsDelivr lists the files, since GitHub's API
// allows only 60 requests an hour from an IP address without a key, and Railway's addresses are
// shared.
export function createSpyglassReader(options: SpyglassReaderOptions): SpyglassReader {
  const get = async (url: string): Promise<unknown> => {
    const response = await options.fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`The server answered HTTP ${String(response.status)} for ${url}.`);
    }
    return response.json();
  };
  const raw = (path: string): Promise<unknown> =>
    get(`https://raw.githubusercontent.com/${repository}/main/${dataPath}/${path}`);

  return async () => {
    const { build } = config.parse(await raw("config.json"));
    const { files } = listing.parse(
      await get(`https://data.jsdelivr.com/v1/packages/gh/${repository}@main?structure=flat`),
    );
    const pathsMatching = (pattern: RegExp): string[] =>
      files.flatMap((file) => pattern.exec(file.name)?.[1] ?? []);

    const dungeons: Dungeon[] = [];
    for (const path of pathsMatching(dungeonFilePath)) {
      const dungeon = dungeonFile.parse(await raw(path));
      if (dungeon.minLevel === undefined || dungeon.maxLevel === undefined) {
        continue;
      }
      dungeons.push({
        name: dungeon.name,
        minLevel: dungeon.minLevel,
        maxLevel: dungeon.maxLevel,
        requiredLevel: dungeon.requiredLevel,
        bosses: dungeon.encounters.map((encounter) => ({
          name: encounter.name,
          loot: encounter.loot.map((item) => ({ itemId: item.item, name: item.name })),
        })),
      });
    }

    const items: ScannedItem[] = [];
    for (const path of pathsMatching(itemFilePath)) {
      for (const [id, item] of Object.entries(itemFile.parse(await raw(path)))) {
        const name = item.names.enUS;
        if (name === undefined) {
          continue;
        }
        items.push({
          id: Number.parseInt(id, 10),
          name,
          quality: item.quality,
          itemLevel: item.itemLevel,
          requiredLevel: item.reqLevel,
          itemClass: item.classID,
          itemSubclass: item.subclassID,
          slot: item.slot,
          stats: Object.entries(item.stats ?? {}).map(([stat, value]) => ({ stat, value })),
        });
      }
    }
    return { build, dungeons, items };
  };
}
