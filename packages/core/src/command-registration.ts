import { createHash } from "node:crypto";
import type { CommandDefinition } from "./feature.ts";

// Where commands get registered: one Discord application's commands in one server.
export interface GuildTarget {
  readonly applicationId: string;
  readonly guildId: string;
}

export interface CommandRegistration extends GuildTarget {
  readonly definitionsHash: string;
}

export interface CommandRegistrationStore {
  readonly lastHash: (target: GuildTarget) => Promise<string | undefined>;
  readonly record: (registration: CommandRegistration) => Promise<void>;
}

export interface CommandRegistrationDeps {
  readonly store: CommandRegistrationStore;
  readonly register: (definitions: readonly CommandDefinition[]) => Promise<void>;
}

export type RegistrationOutcome = "registered" | "unchanged";

function hashDefinitions(definitions: readonly CommandDefinition[]): string {
  return createHash("sha256").update(JSON.stringify(definitions)).digest("hex");
}

// Discord allows 200 command creates per day per server, so only re-register when the command
// definitions differ from the last successful registration for this application and server.
export async function registerCommandsIfChanged(
  target: GuildTarget,
  definitions: readonly CommandDefinition[],
  deps: CommandRegistrationDeps,
): Promise<RegistrationOutcome> {
  const definitionsHash = hashDefinitions(definitions);
  if ((await deps.store.lastHash(target)) === definitionsHash) {
    return "unchanged";
  }
  await deps.register(definitions);
  await deps.store.record({ ...target, definitionsHash });
  return "registered";
}
