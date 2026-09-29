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

const lookup: Feature = {
  commands: [
    {
      definition: { name: "lookup", description: "Look something up." },
      handle: () => Promise.resolve({ content: "Found it." }),
      autocomplete: (query) =>
        Promise.resolve(
          Array.from({ length: 30 }, (_, index) => ({
            name: `${query.value} ${String(index + 1)}`,
            value: String(index + 1),
          })),
        ),
    },
  ],
};

const switcher: Feature = {
  commands: [
    {
      definition: { name: "switch", description: "Show a switch." },
      handle: () => Promise.resolve({ content: "Off" }),
      press: ({ customId }) =>
        Promise.resolve({ kind: "update", message: { content: `Pressed ${customId}` } }),
    },
  ],
};

const brokenSwitch: Feature = {
  commands: [
    {
      definition: { name: "fuse", description: "Always blows." },
      handle: () => Promise.resolve({ content: "Intact" }),
      press: () => Promise.reject(new Error("Pop")),
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

      const result = await registry.dispatch({ commandName, options: new Map() });

      expect(result).toEqual({ kind: "replied", reply: { content } });
    },
  );

  it("doesn't log a known command", async () => {
    const logger = createFakeLogger();
    const registry = createRegistry([greetings, weather], logger);

    await registry.dispatch({ commandName: "bow", options: new Map() });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns an unknown-command result with a private reply instead of throwing", async () => {
    const registry = createRegistry([greetings, weather], createFakeLogger());

    const result = await registry.dispatch({ commandName: "dance", options: new Map() });

    expect(result).toEqual({
      kind: "unknown-command",
      commandName: "dance",
      reply: { content: "I don't know that command.", flags: MessageFlags.Ephemeral },
    });
  });

  it("logs an unknown command", async () => {
    const logger = createFakeLogger();
    const registry = createRegistry([greetings, weather], logger);

    await registry.dispatch({ commandName: "dance", options: new Map() });

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { event: "command.unknown", commandName: "dance" },
      "Unknown command",
    );
  });

  it("turns a handler that throws into a failed result with a private error reply", async () => {
    const registry = createRegistry([greetings, broken], createFakeLogger());

    const result = await registry.dispatch({ commandName: "explode", options: new Map() });

    expect(result).toEqual({
      kind: "failed",
      commandName: "explode",
      reply: { content: "Something went wrong. It's been logged.", flags: MessageFlags.Ephemeral },
    });
  });

  it("logs a handler that throws, with its error", async () => {
    const logger = createFakeLogger();
    const registry = createRegistry([greetings, broken], logger);

    await registry.dispatch({ commandName: "explode", options: new Map() });

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "command.failed", commandName: "explode", err: new Error("Kaboom") },
      "Command failed",
    );
  });

  it("routes an autocomplete query to its command", async () => {
    const registry = createRegistry([greetings, lookup], createFakeLogger());

    const choices = await registry.autocomplete({
      commandName: "lookup",
      optionName: "name",
      value: "Sword",
    });

    expect(choices.slice(0, 2)).toEqual([
      { name: "Sword 1", value: "1" },
      { name: "Sword 2", value: "2" },
    ]);
  });

  it("keeps the first 25 choices, Discord's limit", async () => {
    const registry = createRegistry([greetings, lookup], createFakeLogger());

    const choices = await registry.autocomplete({
      commandName: "lookup",
      optionName: "name",
      value: "Sword",
    });

    expect(choices.map((choice) => choice.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
      "24",
      "25",
    ]);
  });

  it("offers no choices for a command without suggestions", async () => {
    const registry = createRegistry([greetings, lookup], createFakeLogger());

    expect(
      await registry.autocomplete({ commandName: "wave", optionName: "name", value: "a" }),
    ).toEqual([]);
  });

  it("offers no choices, and logs, when suggesting fails", async () => {
    const failing: Feature = {
      commands: [
        {
          definition: { name: "lookup", description: "Look something up." },
          handle: () => Promise.resolve({ content: "Found it." }),
          autocomplete: () => Promise.reject(new Error("Database is down")),
        },
      ],
    };
    const logger = createFakeLogger();
    const registry = createRegistry([failing], logger);

    const choices = await registry.autocomplete({
      commandName: "lookup",
      optionName: "name",
      value: "a",
    });

    expect(choices).toEqual([]);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "autocomplete.failed", commandName: "lookup", err: new Error("Database is down") },
      "Autocomplete failed",
    );
  });

  it("routes a button press to the command named at the start of the button's ID", async () => {
    const registry = createRegistry([greetings, switcher], createFakeLogger());

    expect(await registry.press({ customId: "switch:on" })).toEqual({
      kind: "handled",
      commandName: "switch",
      response: { kind: "update", message: { content: "Pressed switch:on" } },
    });
  });

  it("replies privately to a press of a button no command answers", async () => {
    const registry = createRegistry([greetings], createFakeLogger());

    expect(await registry.press({ customId: "retired:on" })).toEqual({
      kind: "unknown-button",
      commandName: "retired",
      response: {
        kind: "reply",
        message: { content: "That button doesn't work any more.", flags: MessageFlags.Ephemeral },
      },
    });
  });

  it("logs a press of a button no command answers", async () => {
    const logger = createFakeLogger();
    const registry = createRegistry([greetings], logger);

    await registry.press({ customId: "retired:on" });

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { event: "button.unknown", commandName: "retired" },
      "Button press for no command",
    );
  });

  it("turns a press handler that throws into a private error reply", async () => {
    const registry = createRegistry([brokenSwitch], createFakeLogger());

    expect(await registry.press({ customId: "fuse:on" })).toEqual({
      kind: "failed",
      commandName: "fuse",
      response: {
        kind: "reply",
        message: {
          content: "Something went wrong. It's been logged.",
          flags: MessageFlags.Ephemeral,
        },
      },
    });
  });

  it("logs a press handler that throws, with its error", async () => {
    const logger = createFakeLogger();
    const registry = createRegistry([brokenSwitch], logger);

    await registry.press({ customId: "fuse:on" });

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "button.failed", commandName: "fuse", err: new Error("Pop") },
      "Button press failed",
    );
  });
});
