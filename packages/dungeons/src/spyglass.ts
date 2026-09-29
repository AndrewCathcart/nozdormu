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

export interface SpyglassData {
  // The game build the data was scanned in.
  readonly build: string;
  readonly dungeons: readonly Dungeon[];
}

export type SpyglassReader = () => Promise<SpyglassData>;

export interface SpyglassReaderOptions {
  readonly fetch: typeof fetch;
}

const repository = "Karl-HeinzSchneider/WoW-Spyglass";
const dataPath = ".contribute/data";

const config = z.object({ build: z.string() });

const listing = z.object({ files: z.array(z.object({ name: z.string() })) });

// A dungeon file's path in the listing, such as "/.contribute/data/dungeons/deadmines.json".
const dungeonFilePath = /^\/\.contribute\/data\/dungeons\/([a-z0-9_]+\.json)$/;

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

// Reads Forever's dungeons from Spyglass, an MIT-licensed addon whose maintainers scan the game and
// publish what they find on GitHub: its config names the build, and each dungeon has its own file.
// jsDelivr lists the files, since GitHub's API allows only 60 requests an hour from an IP address
// without a key, and Railway's addresses are shared.
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
    const files = listing
      .parse(
        await get(`https://data.jsdelivr.com/v1/packages/gh/${repository}@main?structure=flat`),
      )
      .files.flatMap((file) => dungeonFilePath.exec(file.name)?.[1] ?? []);
    const dungeons: Dungeon[] = [];
    for (const file of files) {
      const dungeon = dungeonFile.parse(await raw(`dungeons/${file}`));
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
    return { build, dungeons };
  };
}
