import { describe, expect, it, vi } from "vitest";
import {
  type CommandRegistrationDeps,
  type CommandRegistrationStore,
  registerCommandsIfChanged,
} from "./command-registration.ts";
import type { CommandDefinition } from "./feature.ts";

const target = { applicationId: "100000000000000001", guildId: "200000000000000002" };
const pingOnly: CommandDefinition[] = [
  { name: "ping", description: "Check that the bot is alive." },
];
const pingAndWave: CommandDefinition[] = [
  { name: "ping", description: "Check that the bot is alive." },
  { name: "wave", description: "Wave at someone." },
];

function createFakeStore(): CommandRegistrationStore {
  const hashes = new Map<string, string>();
  return {
    lastHash: ({ applicationId, guildId }) =>
      Promise.resolve(hashes.get(`${applicationId}/${guildId}`)),
    record: ({ applicationId, guildId, definitionsHash }) => {
      hashes.set(`${applicationId}/${guildId}`, definitionsHash);
      return Promise.resolve();
    },
  };
}

function createDeps() {
  return {
    store: createFakeStore(),
    register: vi.fn<CommandRegistrationDeps["register"]>().mockResolvedValue(undefined),
  } satisfies CommandRegistrationDeps;
}

describe("registerCommandsIfChanged", () => {
  it("registers the commands when the server has none recorded", async () => {
    const deps = createDeps();

    const outcome = await registerCommandsIfChanged(target, pingOnly, deps);

    expect(outcome).toBe("registered");
    expect(deps.register).toHaveBeenCalledExactlyOnceWith(pingOnly);
  });

  it("skips registration when the commands haven't changed since the last one", async () => {
    const deps = createDeps();
    await registerCommandsIfChanged(target, pingOnly, deps);

    const outcome = await registerCommandsIfChanged(target, pingOnly, deps);

    expect(outcome).toBe("unchanged");
    expect(deps.register).toHaveBeenCalledOnce();
  });

  it("registers again when the commands change", async () => {
    const deps = createDeps();
    await registerCommandsIfChanged(target, pingOnly, deps);

    const outcome = await registerCommandsIfChanged(target, pingAndWave, deps);

    expect(outcome).toBe("registered");
    expect(deps.register).toHaveBeenLastCalledWith(pingAndWave);
  });

  it("tries again next time if a registration failed", async () => {
    const deps = createDeps();
    deps.register.mockRejectedValueOnce(new Error("Discord is down"));
    await expect(registerCommandsIfChanged(target, pingOnly, deps)).rejects.toThrow(
      "Discord is down",
    );

    const outcome = await registerCommandsIfChanged(target, pingOnly, deps);

    expect(outcome).toBe("registered");
  });
});
