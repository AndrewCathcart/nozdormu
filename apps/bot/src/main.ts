import {
  createRegistry,
  registerGuildCommands,
  routeInteractions,
  serializeError,
} from "@nozdormu/core";
import { Client, Events, GatewayIntentBits, REST } from "discord.js";
import { pino } from "pino";
import { loadConfig } from "./config.ts";
import { createFeatures } from "./features.ts";
import { explainRejectedSetting } from "./rejections.ts";

const logger = pino({
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: serializeError },
});

async function main(): Promise<void> {
  const loaded = loadConfig(process.env);
  if (!loaded.ok) {
    logger.fatal({ event: "config.invalid", problems: loaded.problems }, "Invalid configuration");
    process.exitCode = 1;
    return;
  }
  const { discord } = loaded.config;

  const registry = createRegistry(createFeatures(), logger);
  const rest = new REST().setToken(discord.token);
  try {
    await registerGuildCommands(rest, discord, registry.commandDefinitions);
  } catch (error) {
    const problem = explainRejectedSetting(error);
    if (problem === undefined) {
      throw error;
    }
    logger.fatal({ event: "config.rejected", problems: [problem] }, "Discord rejected a setting");
    process.exitCode = 1;
    return;
  }
  logger.info(
    { event: "commands.registered", count: registry.commandDefinitions.length },
    "Commands registered",
  );

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
  process.exitCode = 1;
});
