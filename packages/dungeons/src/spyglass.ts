import type { ScannedItem } from "@nozdormu/gamedata";
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

export const faction = z.enum(["Alliance", "Horde", "Both"]);
export type Faction = z.infer<typeof faction>;

// A quest for the dungeon. Spyglass hasn't scanned every detail of every quest, so only its ID and
// name are certain.
export interface Quest {
  readonly id: number;
  readonly name: string;
  readonly side: Faction | undefined;
  // The class that can take it, for a class quest, such as "Warlock".
  readonly className: string | undefined;
  // The level needed to take it.
  readonly requiredLevel: number | undefined;
  readonly xp: number | undefined;
  readonly objective: string | undefined;
  readonly rewards: readonly LootItem[];
}

export interface Dungeon {
  readonly name: string;
  readonly minLevel: number;
  readonly maxLevel: number;
  // The level needed to enter, where known.
  readonly requiredLevel: number | undefined;
  // In the game's encounter order, which isn't always the order they're fought in.
  readonly bosses: readonly Boss[];
  readonly quests: readonly Quest[];
}

export interface SpyglassData {
  // The game build the data was scanned in.
  readonly build: string;
  readonly dungeons: readonly Dungeon[];
  readonly items: readonly ScannedItem[];
  // Data files the listing named that GitHub doesn't have, by path under the data folder.
  readonly missingFiles: readonly string[];
}

export type SpyglassReader = () => Promise<SpyglassData>;

export interface SpyglassReaderOptions {
  readonly fetch: typeof fetch;
}

const repository = "Karl-HeinzSchneider/WoW-Spyglass";
const dataPath = ".contribute/data";

const commitId = z.string().regex(/^[0-9a-f]{40}$/);

type ListedFile = { readonly found: true; readonly body: unknown } | { readonly found: false };
const notFound: ListedFile = { found: false };

function failed(response: Response, url: string): Error {
  return new Error(`The server answered HTTP ${String(response.status)} for ${url}.`);
}

const config = z.object({ build: z.string() });

const listing = z.object({ files: z.array(z.object({ name: z.string() })) });

// A dungeon file's path in the listing, such as "/.contribute/data/dungeons/deadmines.json", and an
// item file's, such as "/.contribute/data/items/items_270000.json".
const dungeonFilePath = /^\/\.contribute\/data\/(dungeons\/[a-z0-9_]+\.json)$/;
const itemFilePath = /^\/\.contribute\/data\/(items\/items_\d+\.json)$/;
// A dungeon's quest file, such as "/.contribute/data/quests/dungeons/deadmines.json".
const questFilePath = /^\/\.contribute\/data\/(quests\/dungeons\/[a-z0-9_]+\.json)$/;

// A quest as Spyglass lists it. Only the ID and name are needed; a detail that isn't what's
// expected is left out rather than failing the quest.
const questEntry = z.object({
  id: z.int().positive(),
  name: z.string(),
  side: faction.optional().catch(undefined),
  class: z.string().optional().catch(undefined),
  requiredLevel: z.int().optional().catch(undefined),
  xp: z.int().optional().catch(undefined),
  objective: z.string().optional().catch(undefined),
  items: z
    .array(z.object({ item: z.int().positive(), name: z.string() }))
    .optional()
    .catch(undefined),
});

const questId = z.int().positive();

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
  // The IDs of the dungeon's quests, whose details are in its quest file. One it can't read is
  // left out, so one odd quest doesn't fail the sync.
  quests: z
    .array(z.unknown())
    .optional()
    .transform((ids) => (ids ?? []).flatMap((id) => questId.safeParse(id).data ?? [])),
});

// A dungeon's quest file: its quests, and the quests leading up to them, which happen outside it.
// Each quest is read on its own (`questEntry`), so one odd quest doesn't fail the sync.
const questFile = z.object({ quests: z.array(z.unknown()) });

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
// file, and items come in files of up to 10,000 IDs. Everything is read from its latest commit, so
// the listing and the files match. GitHub's API names the commit, in one request a sync, since it
// allows only 60 an hour from an IP address without a key, and Railway's addresses are shared.
// jsDelivr lists the files at that commit; its listing of the main branch is cached for up to a
// year.
export function createSpyglassReader(options: SpyglassReaderOptions): SpyglassReader {
  const request = (url: string, headers: Record<string, string> = {}): Promise<Response> =>
    options.fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const answer = async (url: string, headers?: Record<string, string>): Promise<Response> => {
    const response = await request(url, headers);
    if (!response.ok) {
      throw failed(response, url);
    }
    return response;
  };
  const get = async (url: string): Promise<unknown> => (await answer(url)).json();

  return async () => {
    const latest = await answer(`https://api.github.com/repos/${repository}/commits/main`, {
      accept: "application/vnd.github.sha",
    });
    const commit = commitId.parse((await latest.text()).trim());
    const rawUrl = (path: string): string =>
      `https://raw.githubusercontent.com/${repository}/${commit}/${dataPath}/${path}`;
    const raw = (path: string): Promise<unknown> => get(rawUrl(path));
    const missingFiles: string[] = [];
    // A file the listing names, which is noted as missing if GitHub and jsDelivr disagree.
    const listedFile = async (path: string): Promise<ListedFile> => {
      const url = rawUrl(path);
      const response = await request(url);
      if (response.status === 404) {
        missingFiles.push(path);
        return notFound;
      }
      if (!response.ok) {
        throw failed(response, url);
      }
      return { found: true, body: await response.json() };
    };

    const { build } = config.parse(await raw("config.json"));
    const { files } = listing.parse(
      await get(`https://data.jsdelivr.com/v1/packages/gh/${repository}@${commit}?structure=flat`),
    );
    const pathsMatching = (pattern: RegExp): string[] =>
      files.flatMap((file) => pattern.exec(file.name)?.[1] ?? []);
    const questPaths = new Set(pathsMatching(questFilePath));

    const dungeons: Dungeon[] = [];
    for (const path of pathsMatching(dungeonFilePath)) {
      const file = await listedFile(path);
      if (!file.found) {
        continue;
      }
      const dungeon = dungeonFile.parse(file.body);
      if (dungeon.minLevel === undefined || dungeon.maxLevel === undefined) {
        continue;
      }
      const questPath = `quests/${path}`;
      const questsFile = questPaths.has(questPath) ? await listedFile(questPath) : notFound;
      const quests = questsFile.found
        ? questFile.parse(questsFile.body).quests.flatMap((entry) => {
            const parsed = questEntry.safeParse(entry);
            return parsed.success ? [parsed.data] : [];
          })
        : [];
      dungeons.push({
        name: dungeon.name,
        minLevel: dungeon.minLevel,
        maxLevel: dungeon.maxLevel,
        requiredLevel: dungeon.requiredLevel,
        bosses: dungeon.encounters.map((encounter) => ({
          name: encounter.name,
          loot: encounter.loot.map((item) => ({ itemId: item.item, name: item.name })),
        })),
        quests: dungeon.quests
          .flatMap((id) => quests.find((quest) => quest.id === id) ?? [])
          .map((quest) => ({
            id: quest.id,
            name: quest.name,
            side: quest.side,
            className: quest.class,
            requiredLevel: quest.requiredLevel,
            xp: quest.xp,
            objective: quest.objective,
            rewards: (quest.items ?? []).map((item) => ({ itemId: item.item, name: item.name })),
          })),
      });
    }

    const items: ScannedItem[] = [];
    for (const path of pathsMatching(itemFilePath)) {
      const file = await listedFile(path);
      if (!file.found) {
        continue;
      }
      for (const [id, item] of Object.entries(itemFile.parse(file.body))) {
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
    return { build, dungeons, items, missingFiles };
  };
}
