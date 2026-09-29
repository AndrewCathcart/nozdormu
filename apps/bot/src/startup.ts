import type { Logger } from "@nozdormu/core";
import { connectDatabase, type DatabaseConnection } from "@nozdormu/db";
import { type Config, loadConfig } from "./config.ts";
import { explainDatabaseFailure } from "./startup-failures.ts";

// Shared by the bot and the migrate script: both stop with a message naming the bad setting.

export function loadConfigOrExit(logger: Pick<Logger, "fatal">): Config {
  const loaded = loadConfig(process.env);
  if (!loaded.ok) {
    logger.fatal({ event: "config.invalid", problems: loaded.problems }, "Invalid configuration");
    process.exit(1);
  }
  return loaded.config;
}

export async function connectDatabaseOrExit(
  url: string,
  logger: Pick<Logger, "fatal">,
): Promise<DatabaseConnection> {
  try {
    return await connectDatabase(url);
  } catch (error) {
    const problem = explainDatabaseFailure(error);
    if (problem !== undefined) {
      logger.fatal({ event: "config.rejected", problems: [problem] }, "Couldn't use DATABASE_URL");
      process.exit(1);
    }
    throw error;
  }
}
