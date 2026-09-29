// Runs one scheduled job once, outside the scheduler, against the real feed and database.
//   pnpm job <job-name>            does everything the job does, including posting to Discord
//   pnpm job <job-name> --dry-run  prints what it would post or record, and changes nothing
// A dry run prints the posts it would make to the terminal, never into the logs.
import { createLogger } from "@nozdormu/core";
import type { ItemStore } from "@nozdormu/gamedata";
import type { SeenVideoStore } from "@nozdormu/youtube";
import { REST } from "discord.js";
import {
  createFeatureDeps,
  createFeatures,
  type FeatureDeps,
  scheduledJobs,
} from "../src/features.ts";
import { connectDatabaseOrExit, loadConfigOrExit } from "../src/startup.ts";

const logger = createLogger();

function readOnlySeenVideos(store: SeenVideoStore): SeenVideoStore {
  return {
    history: store.history,
    recordFirstCheck: (youtubeChannelId, videos) => {
      logger.info(
        { event: "dry_run.first_check", youtubeChannelId, videos: videos.length },
        "Would record the first check",
      );
      return Promise.resolve();
    },
    markSeen: (youtubeChannelId, videos) => {
      logger.info(
        { event: "dry_run.mark_seen", youtubeChannelId, videoIds: videos.map((video) => video.id) },
        "Would mark as seen",
      );
      return Promise.resolve();
    },
  };
}

function readOnlyItems(store: ItemStore): ItemStore {
  return {
    ...store,
    replaceAll: (version, records) => {
      logger.info(
        { event: "dry_run.import", version, items: records.length },
        "Would replace the stored items",
      );
      return Promise.resolve();
    },
  };
}

function dryRun(deps: FeatureDeps): FeatureDeps {
  return {
    ...deps,
    seenVideos: readOnlySeenVideos(deps.seenVideos),
    items: readOnlyItems(deps.items),
    publish: (channelId, message) => {
      console.log(`\nDRY RUN: would post in channel ${channelId}:\n${message.content ?? ""}\n`);
      return Promise.resolve();
    },
  };
}

async function runJob(): Promise<void> {
  const [jobName, ...flags] = process.argv.slice(2);
  const isDryRun = flags.includes("--dry-run");
  const config = loadConfigOrExit(logger);
  const database = await connectDatabaseOrExit(config.database.url, logger);
  try {
    const rest = new REST().setToken(config.discord.token);
    const deps = createFeatureDeps(config, database.db, rest, logger);
    const jobs = scheduledJobs(createFeatures(isDryRun ? dryRun(deps) : deps));
    const job = jobs.find((candidate) => candidate.name === jobName);
    if (job === undefined) {
      logger.fatal(
        { event: "job.unknown", job: jobName, jobs: jobs.map((candidate) => candidate.name) },
        "Usage: pnpm job <job-name> [--dry-run]",
      );
      process.exitCode = 1;
      return;
    }
    const startedAt = performance.now();
    await job.run();
    logger.info(
      {
        event: "job.finished",
        job: job.name,
        dryRun: isDryRun,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "Job finished",
    );
  } finally {
    await database.close();
  }
}

runJob().catch((error: unknown) => {
  logger.fatal({ event: "job.failed", err: error }, "Job failed");
  process.exit(1);
});
