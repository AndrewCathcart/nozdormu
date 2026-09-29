import {
  createLogger,
  createRegistry,
  registerCommandsIfChanged,
  registerGuildCommands,
  routeInteractions,
} from "@nozdormu/core";
import { createCommandRegistrationStore } from "@nozdormu/db";
import { Client, Events, GatewayIntentBits, REST } from "discord.js";
import { createFeatures } from "./features.ts";
import { explainDiscordRejection } from "./startup-failures.ts";
import { connectDatabaseOrExit, loadConfigOrExit } from "./startup.ts";

const logger = createLogger();

async function main(): Promise<void> {
  const config = loadConfigOrExit(logger);
  const { discord } = config;
  const database = await connectDatabaseOrExit(config.database.url, logger);

  const registry = createRegistry(createFeatures(), logger);
  const rest = new REST().setToken(discord.token);
  try {
    const outcome = await registerCommandsIfChanged(discord, registry.commandDefinitions, {
      store: createCommandRegistrationStore(database.db),
      register: (definitions) => registerGuildCommands(rest, discord, definitions),
    });
    logger.info(
      { event: `commands.${outcome}`, count: registry.commandDefinitions.length },
      outcome === "registered" ? "Commands registered" : "Commands unchanged since last start",
    );
  } catch (error) {
    await database.close();
    const problem = explainDiscordRejection(error);
    if (problem === undefined) {
      throw error;
    }
    logger.fatal({ event: "config.rejected", problems: [problem] }, "Discord rejected a setting");
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  routeInteractions(client, rest, registry, logger);
  client.once(Events.ClientReady, (ready) => {
    logger.info({ event: "bot.ready", user: ready.user.tag }, "Bot ready");
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      logger.info({ event: "bot.stopping", signal }, "Stopping");
      client
        .destroy()
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

  await client.login(discord.token);
}

main().catch((error: unknown) => {
  logger.fatal({ event: "bot.crashed", err: error }, "Bot crashed");
  process.exit(1);
});
