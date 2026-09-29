// Starts the bot against the Dev app, waits until it's ready, checks that Discord has exactly the
// bot's commands registered for the test server, then stops it. Needs a filled-in .env.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { REST, Routes } from "discord.js";
import { z } from "zod";
import { loadConfig } from "../src/config.ts";
import { createFeatures } from "../src/features.ts";

const timeoutMs = 30_000;

const logLine = z.object({ event: z.string() });
const registeredCommands = z.array(z.object({ name: z.string() }));

function eventOf(line: string): string | undefined {
  try {
    const parsed = logLine.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data.event : undefined;
  } catch {
    return undefined;
  }
}

function listCommands(names: readonly string[]): string {
  return names.map((name) => `/${name}`).join(", ") || "none";
}

const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Smoke run needs a valid .env:\n${loaded.problems.join("\n")}`);
  process.exit(1);
}
const { discord } = loaded.config;
const expected = createFeatures()
  .flatMap((feature) => feature.commands.map((command) => command.definition.name))
  .toSorted();

const bot = spawn(process.execPath, [fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
  stdio: ["ignore", "pipe", "inherit"],
});

function finish(code: number, message: string): void {
  console.log(message);
  bot.kill();
  process.exit(code);
}

const timer = setTimeout(() => {
  finish(1, `Smoke run failed: the bot wasn't ready within ${String(timeoutMs / 1000)}s.`);
}, timeoutMs);

bot.on("exit", (code) => {
  clearTimeout(timer);
  finish(1, `Smoke run failed: the bot exited early with code ${String(code)}.`);
});

createInterface({ input: bot.stdout }).on("line", (line) => {
  console.log(line);
  if (eventOf(line) !== "bot.ready") {
    return;
  }
  clearTimeout(timer);
  new REST()
    .setToken(discord.token)
    .get(Routes.applicationGuildCommands(discord.applicationId, discord.guildId))
    .then((body) => {
      const actual = registeredCommands
        .parse(body)
        .map((command) => command.name)
        .toSorted();
      if (actual.join() !== expected.join()) {
        finish(
          1,
          `Smoke run failed: Discord has ${listCommands(actual)}, but the bot defines ${listCommands(expected)}.`,
        );
        return;
      }
      finish(
        0,
        `Smoke run passed: the bot is ready, and Discord has exactly ${listCommands(actual)} registered.`,
      );
    })
    .catch((error: unknown) => {
      finish(1, `Smoke run failed: couldn't ask Discord for the commands (${String(error)}).`);
    });
});
