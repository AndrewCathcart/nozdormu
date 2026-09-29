import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  Routes,
} from "discord-api-types/v10";
import type { REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createScheduledEvents } from "./scheduled-events.ts";

// Made up.
const guildId = "100000000000000001";

function createFakeRest(events: unknown) {
  return {
    get: vi.fn<REST["get"]>().mockResolvedValue(events),
    post: vi.fn<REST["post"]>().mockResolvedValue({}),
  } satisfies Pick<REST, "get" | "post">;
}

describe("createScheduledEvents", () => {
  it("gives the names of the server's scheduled events", async () => {
    const rest = createFakeRest([
      { id: "1", name: "Made-up Launch Night" },
      { id: "2", name: "Made-up Raid" },
    ]);

    expect(await createScheduledEvents(rest, guildId).names()).toEqual(
      new Set(["Made-up Launch Night", "Made-up Raid"]),
    );
    expect(rest.get).toHaveBeenCalledExactlyOnceWith(Routes.guildScheduledEvents(guildId));
  });

  it("creates an event in Azeroth that only the server's members can see", async () => {
    const rest = createFakeRest([]);

    await createScheduledEvents(rest, guildId).create({
      name: "Made-up Launch Night",
      description: "Made-up Game goes live.",
      startsAt: new Date("2026-11-04T23:00:00Z"),
      endsAt: new Date("2026-11-05T02:00:00Z"),
    });

    expect(rest.post).toHaveBeenCalledExactlyOnceWith(Routes.guildScheduledEvents(guildId), {
      body: {
        name: "Made-up Launch Night",
        description: "Made-up Game goes live.",
        scheduled_start_time: "2026-11-04T23:00:00.000Z",
        scheduled_end_time: "2026-11-05T02:00:00.000Z",
        privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
        entity_type: GuildScheduledEventEntityType.External,
        entity_metadata: { location: "Azeroth" },
      },
    });
  });
});
