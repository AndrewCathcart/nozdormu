import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
export const gameBuilds = pgTable("game_builds", {
  version: text("version").primaryKey(),
  itemCount: integer("item_count").notNull(),
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
