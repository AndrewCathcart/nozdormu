import type { LogFn, Logger } from "pino";
import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import type { Feature } from "./feature.ts";
import { createRegistry } from "./registry.ts";

const greetings: Feature = {
  commands: [
    {
      definition: { name: "wave", description: "Wave at someone." },
      handle: () => Promise.resolve({ content: "*waves*" }),
    },
    {
      definition: { name: "bow", description: "Bow politely." },
      handle: () => Promise.resolve({ content: "*bows*" }),
    },
  ],
};

const weather: Feature = {
  commands: [
    {
      definition: { name: "rain", description: "Make it rain." },
      handle: () => Promise.resolve({ content: "It's raining." }),
    },
  ],
};

const broken: Feature = {
  commands: [
    {
      definition: { name: "explode", description: "Always fails." },
      handle: () => Promise.reject(new Error("Kaboom")),
    },
  ],
};

function createFakeLogger() {
  return { warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() } satisfies Pick<Logger, "warn" | "error">;
}

describe("createRegistry", () => {
  it("refuses a command name that is defined more than once", () => {
    const moreGreetings: Feature = {
      commands: [
        {
          definition: { name: "wave", description: "Wave again." },
          handle: () => Promise.resolve({ content: "*waves again*" }),
        },
      ],
    };

    expect(() => createRegistry([greetings, moreGreetings], createFakeLogger())).toThrow(
      new Error("The command /wave is defined more than once."),
    );
  });

  it("collects the command definitions of every feature", () => {
    const registry = createRegistry([greetings, weather], createFakeLogger());

    expect(registry.commandDefinitions).toEqual([
      { name: "wave", description: "Wave at someone." },
      { name: "bow", description: "Bow politely." },
      { name: "rain", description: "Make it rain." },
    ]);
  });

  it.each([
    { commandName: "wave", content: "*waves*" },
    { commandName: "bow", content: "*bows*" },
    { commandName: "rain", content: "It's raining." },
  ])(
    "routes /$commandName to the handler of the feature that owns it",
    async ({ commandName, content }) => {
      const registry = createRegistry([greetings, weather], createFakeLogger());

      const result = await registry.dispatch({ commandName });

      expect(result).toEqual({ kind: "replied", reply: { content } });
    },
  );

  it("doesn't log a known command", async () => {
    const logger = createFakeLogger();
    const registry = createRegistry([greetings, weather], logger);

    await registry.dispatch({ commandName: "bow" });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns an unknown-command result with a private reply instead of throwing", async () => {
    const registry = createRegistry([greetings, weather], createFakeLogger());

    const result = await registry.dispatch({ commandName: "dance" });

    expect(result).toEqual({
      kind: "unknown-command",
      commandName: "dance",
      reply: { content: "I don't know that command.", flags: MessageFlags.Ephemeral },
    });
  });

  it("logs an unknown command", async () => {
    const logger = createFakeLogger();
    const registry = createRegistry([greetings, weather], logger);

    await registry.dispatch({ commandName: "dance" });

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { event: "command.unknown", commandName: "dance" },
      "Unknown command",
    );
  });

  it("turns a handler that throws into a failed result with a private error reply", async () => {
    const registry = createRegistry([greetings, broken], createFakeLogger());

    const result = await registry.dispatch({ commandName: "explode" });

    expect(result).toEqual({
      kind: "failed",
      commandName: "explode",
      reply: { content: "Something went wrong. It's been logged.", flags: MessageFlags.Ephemeral },
    });
  });

  it("logs a handler that throws, with its error", async () => {
    const logger = createFakeLogger();
    const registry = createRegistry([greetings, broken], logger);

    await registry.dispatch({ commandName: "explode" });

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "command.failed", commandName: "explode", err: new Error("Kaboom") },
      "Command failed",
    );
  });
});
