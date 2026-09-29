import {
  createLogger,
  createRegistry,
  registerCommandsIfChanged,
  registerGuildCommands,
  routeInteractions,
  startScheduler,
} from "@nozdormu/core";
import { createCommandRegistrationStore, createJobRunStore } from "@nozdormu/db";
import { Client, Events, GatewayIntentBits, REST } from "discord.js";
import { createFeatureDeps, createFeatures, scheduledJobs } from "./features.ts";
import { connectDatabaseOrExit, exitOnDiscordRejection, loadConfigOrExit } from "./startup.ts";

const logger = createLogger();

async function main(): Promise<void> {
  const config = loadConfigOrExit(logger);
  const { discord } = config;
  const database = await connectDatabaseOrExit(config.database.url, logger);

  const rest = new REST().setToken(discord.token);
  const features = createFeatures(createFeatureDeps(config, database.db, rest, logger));
  const registry = createRegistry(features, logger);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  // Started before anything touches Discord, so bad job definitions fail first. Jobs talk to
  // Discord over REST, so they don't need the gateway.
  const scheduler = startScheduler(scheduledJobs(features), {
    store: createJobRunStore(database.db),
    logger,
    stopTimeoutMs: 10_000,
  });

  const shutDown = async (): Promise<void> => {
    await scheduler.stop();
    await client.destroy();
    await database.close();
  };

  // Installed straight after the scheduler starts, so a signal at any later point stops it.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      logger.info({ event: "bot.stopping", signal }, "Stopping");
      shutDown()
        .then(() => {
          logger.info({ event: "bot.stopped" }, "Stopped");
          process.exit(0);
        })
        .catch((error: unknown) => {
          logger.error({ event: "bot.stop_failed", err: error }, "Couldn't stop cleanly");
          process.exit(1);
        });
    });
  }

  try {
    const outcome = await registerCommandsIfChanged(discord, registry.commandDefinitions, {
      store: createCommandRegistrationStore(database.db),
      register: (definitions) => registerGuildCommands(rest, discord, definitions),
    });
    logger.info(
      {
        event: `commands.${outcome}`,
        commands: registry.commandDefinitions.map((definition) => definition.name),
      },
      outcome === "registered" ? "Commands registered" : "Commands unchanged since last start",
    );
  } catch (error) {
    await shutDown();
    exitOnDiscordRejection(error, logger);
  }

  routeInteractions(client, rest, registry, logger);
  client.once(Events.ClientReady, (ready) => {
    logger.info({ event: "bot.ready", user: ready.user.tag }, "Bot ready");
  });

  try {
    await client.login(discord.token);
  } catch (error) {
    await shutDown();
    exitOnDiscordRejection(error, logger);
  }
}

main().catch((error: unknown) => {
  logger.fatal({ event: "bot.crashed", err: error }, "Bot crashed");
  process.exit(1);
});
