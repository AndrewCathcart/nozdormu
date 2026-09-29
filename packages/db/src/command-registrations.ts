import type { CommandRegistrationStore } from "@nozdormu/core";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client.ts";
import { commandRegistrations } from "./schema.ts";

export function createCommandRegistrationStore(db: Database): CommandRegistrationStore {
  return {
    lastHash: async ({ applicationId, guildId }) => {
      const [row] = await db
        .select({ definitionsHash: commandRegistrations.definitionsHash })
        .from(commandRegistrations)
        .where(
          and(
            eq(commandRegistrations.applicationId, applicationId),
            eq(commandRegistrations.guildId, guildId),
          ),
        );
      return row?.definitionsHash;
    },
    record: async ({ applicationId, guildId, definitionsHash }) => {
      await db
        .insert(commandRegistrations)
        .values({ applicationId, guildId, definitionsHash })
        .onConflictDoUpdate({
          target: [commandRegistrations.applicationId, commandRegistrations.guildId],
          set: { definitionsHash, registeredAt: sql`now()` },
        });
    },
  };
}
