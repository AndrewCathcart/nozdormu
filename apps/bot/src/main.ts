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
import { createFeatures } from "./features.ts";
import { connectDatabaseOrExit, exitOnDiscordRejection, loadConfigOrExit } from "./startup.ts";

const logger = createLogger();

async function main(): Promise<void> {
  const config = loadConfigOrExit(logger);
  const { discord } = config;
  const database = await connectDatabaseOrExit(config.database.url, logger);

  const features = createFeatures();
  const registry = createRegistry(features, logger);
  // Started before anything touches Discord, so bad job definitions fail first and a shutdown
  // signal always finds it. Jobs talk to Discord over REST, so they don't need the gateway.
  const scheduler = startScheduler(
    features.flatMap((feature) => feature.jobs ?? []),
    { store: createJobRunStore(database.db), logger, stopTimeoutMs: 10_000 },
  );
  const rest = new REST().setToken(discord.token);
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
    await scheduler.stop();
    await database.close();
    exitOnDiscordRejection(error, logger);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  routeInteractions(client, rest, registry, logger);
  client.once(Events.ClientReady, (ready) => {
    logger.info({ event: "bot.ready", user: ready.user.tag }, "Bot ready");
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      logger.info({ event: "bot.stopping", signal }, "Stopping");
      scheduler
        .stop()
        .then(() => client.destroy())
        .then(() => database.close())
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
    await client.login(discord.token);
  } catch (error) {
    await scheduler.stop();
    await database.close();
    exitOnDiscordRejection(error, logger);
  }
}

main().catch((error: unknown) => {
  logger.fatal({ event: "bot.crashed", err: error }, "Bot crashed");
  process.exit(1);
});
