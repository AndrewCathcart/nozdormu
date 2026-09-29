// Applies pending migrations to DATABASE_URL, then exits. Railway will run this before each deploy.
import { createLogger } from "@nozdormu/core";
import { runMigrations } from "@nozdormu/db";
import { connectDatabaseOrExit, loadConfigOrExit } from "./startup.ts";

const logger = createLogger();

async function migrate(): Promise<void> {
  const config = loadConfigOrExit(logger);
  const database = await connectDatabaseOrExit(config.database.url, logger);
  const startedAt = performance.now();
  try {
    const applied = await runMigrations(database.db);
    logger.info(
      {
        event: "migrations.applied",
        applied,
        durationMs: Math.round(performance.now() - startedAt),
      },
      applied === 0 ? "Database already up to date" : "Migrations applied",
    );
  } finally {
    await database.close();
  }
}

migrate().catch((error: unknown) => {
  logger.fatal({ event: "migrations.failed", err: error }, "Migrations failed");
  process.exit(1);
});
