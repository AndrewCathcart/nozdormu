import type { LogFn, Logger } from "pino";
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

function createFakeLogger() {
  return { warn: vi.fn<LogFn>() } satisfies Pick<Logger, "warn">;
}

describe("createRegistry", () => {
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

  it("returns an unknown-command result instead of throwing", async () => {
    const registry = createRegistry([greetings, weather], createFakeLogger());

    const result = await registry.dispatch({ commandName: "dance" });

    expect(result).toEqual({ kind: "unknown-command", commandName: "dance" });
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
});
