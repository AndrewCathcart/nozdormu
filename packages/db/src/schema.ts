import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// The hash of the command definitions last registered for each application in each server, so
// startup only re-registers commands when they've changed.
export const commandRegistrations = pgTable(
  "command_registrations",
  {
    applicationId: text("application_id").notNull(),
    guildId: text("guild_id").notNull(),
    definitionsHash: text("definitions_hash").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.applicationId, table.guildId] })],
);

// When each scheduled job's latest run started. The scheduler claims a run by updating this
// row, so a restart knows when each job is next due and two processes can't run a job at once.
export const jobRuns = pgTable("job_runs", {
  jobName: text("job_name").primaryKey(),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }).notNull(),
});

// YouTube channels the alert has checked at least once, so an empty first check still counts. The
// baseline is the newest publish time in the feed at that first check: an unseen video no newer
// than it is an old one resurfacing (say, after a newer one was deleted), not a new upload.
export const youtubeChannels = pgTable("youtube_channels", {
  youtubeChannelId: text("youtube_channel_id").primaryKey(),
  firstCheckedAt: timestamp("first_checked_at", { withTimezone: true }).notNull().defaultNow(),
  baselinePublishedAt: timestamp("baseline_published_at", { withTimezone: true }),
});

// Videos the YouTube alert has seen in each watched channel: posted, or already there at the first
// check.
export const youtubeVideos = pgTable(
  "youtube_videos",
  {
    youtubeChannelId: text("youtube_channel_id").notNull(),
    videoId: text("video_id").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.youtubeChannelId, table.videoId] })],
);

// The game-data builds imported from wago.tools; the newest row is the build the items come from.
// import_format is the version of the import code that stored it; rows from before it existed are 1.
export const gameBuilds = pgTable("game_builds", {
  version: text("version").primaryKey(),
  itemCount: integer("item_count").notNull(),
  importFormat: integer("import_format").notNull().default(1),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

// World of Warcraft: Forever items, replaced wholesale by each import.
export const items = pgTable(
  "items",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    quality: integer("quality").notNull(),
    itemLevel: integer("item_level").notNull(),
    requiredLevel: integer("required_level").notNull(),
    inventoryType: integer("inventory_type").notNull(),
  },
  (table) => [index("items_name_trigram").using("gin", table.name.op("gin_trgm_ops"))],
);

// Profession recipes, replaced wholesale with the items by each import. Keyed by the recipe's
// spell. The item and its count are both null for an enchant, and the skill levels are both null
// where the game data has none.
export const recipes = pgTable(
  "recipes",
  {
    spellId: integer("spell_id").primaryKey(),
    name: text("name").notNull(),
    professions: text("professions").array().notNull(),
    itemId: integer("item_id"),
    itemCount: integer("item_count"),
    yellowAt: integer("yellow_at"),
    greyAt: integer("grey_at"),
    // The recipe items that teach it.
    taughtBy: integer("taught_by").array().notNull(),
  },
  (table) => [
    check("recipes_item_and_count", sql`(${table.itemId} is null) = (${table.itemCount} is null)`),
    check("recipes_skill_levels", sql`(${table.yellowAt} is null) = (${table.greyAt} is null)`),
  ],
);

// Each recipe's reagents, in the game's order.
export const recipeReagents = pgTable(
  "recipe_reagents",
  {
    spellId: integer("spell_id")
      .notNull()
      .references(() => recipes.spellId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    itemId: integer("item_id").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.spellId, table.position] })],
);

// The spells each class learns from its trainer, replaced wholesale with the items by each import.
// The rank is null for a spell with no ranks, and races is empty when every race learns it.
export const classSpells = pgTable(
  "class_spells",
  {
    classId: integer("class_id").notNull(),
    spellId: integer("spell_id").notNull(),
    level: integer("level").notNull(),
    name: text("name").notNull(),
    rank: integer("rank"),
    races: text("races").array().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.classId, table.spellId] }),
    index("class_spells_class_level").on(table.classId, table.level),
  ],
);

// Forum staff-post feeds the Forever news channel has checked at least once, so an empty first
// check still counts. The baseline is the newest post's time at that first check: an unseen post no
// newer than it was already there (or has resurfaced, say after a newer one was deleted), not new.
export const bluePostFeeds = pgTable("blue_post_feeds", {
  feed: text("feed").primaryKey(),
  firstCheckedAt: timestamp("first_checked_at", { withTimezone: true }).notNull().defaultNow(),
  baselineCreatedAt: timestamp("baseline_created_at", { withTimezone: true }),
});

// Staff posts each feed has seen: posted, or already there at the first check. Keyed by the
// forum's post ID.
export const bluePosts = pgTable(
  "blue_posts",
  {
    feed: text("feed").notNull(),
    postId: integer("post_id").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.feed, table.postId] })],
);

// Forever's dungeons, from Spyglass, replaced wholesale by each sync. The build is the one Spyglass
// scanned them in, and the required level is null where it isn't known.
export const dungeons = pgTable("dungeons", {
  name: text("name").primaryKey(),
  minLevel: integer("min_level").notNull(),
  maxLevel: integer("max_level").notNull(),
  requiredLevel: integer("required_level"),
  sourceBuild: text("source_build").notNull(),
});

// Each dungeon's bosses, in the order they're usually fought.
export const dungeonBosses = pgTable(
  "dungeon_bosses",
  {
    dungeon: text("dungeon")
      .notNull()
      .references(() => dungeons.name, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
  },
  (table) => [primaryKey({ columns: [table.dungeon, table.position] })],
);

// The loot seen from each boss so far, in Spyglass's order.
export const dungeonLoot = pgTable(
  "dungeon_loot",
  {
    dungeon: text("dungeon").notNull(),
    bossPosition: integer("boss_position").notNull(),
    position: integer("position").notNull(),
    itemId: integer("item_id").notNull(),
    itemName: text("item_name").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dungeon, table.bossPosition, table.position] }),
    foreignKey({
      columns: [table.dungeon, table.bossPosition],
      foreignColumns: [dungeonBosses.dungeon, dungeonBosses.position],
    }).onDelete("cascade"),
  ],
);

// Items as Spyglass scanned them in the game, replaced with the dungeons by each sync. The class and
// subclass are the game's IDs for what kind of item it is, such as 4 (armour) and 2 (leather), and
// the slot is its name for where it's worn, such as "INVTYPE_NECK".
export const scannedItems = pgTable("scanned_items", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  quality: integer("quality").notNull(),
  itemLevel: integer("item_level").notNull(),
  requiredLevel: integer("required_level").notNull(),
  itemClass: integer("item_class").notNull(),
  itemSubclass: integer("item_subclass").notNull(),
  slot: text("slot").notNull(),
});

// Each scanned item's exact stats, by the game's name for them, such as "STAMINA".
export const scannedItemStats = pgTable(
  "scanned_item_stats",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => scannedItems.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    stat: text("stat").notNull(),
    value: real("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.position] })],
);
