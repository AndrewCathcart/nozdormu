import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type RESTPostAPIGuildScheduledEventJSONBody,
  Routes,
} from "discord-api-types/v10";
import type { REST } from "discord.js";
import { z } from "zod";

export interface ScheduledEvent {
  readonly name: string;
  readonly description: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

// The server's Discord Events, which members can mark "Interested" in to be reminded.
export interface ScheduledEvents {
  readonly names: () => Promise<Set<string>>;
  readonly create: (event: ScheduledEvent) => Promise<void>;
}

const events = z.array(z.object({ name: z.string() }));

// Through Discord's REST API. Creating one needs the Manage Events permission.
export function createScheduledEvents(
  rest: Pick<REST, "get" | "post">,
  guildId: string,
): ScheduledEvents {
  return {
    names: async () =>
      new Set(
        events.parse(await rest.get(Routes.guildScheduledEvents(guildId))).map((e) => e.name),
      ),
    create: async (event) => {
      const body: RESTPostAPIGuildScheduledEventJSONBody = {
        name: event.name,
        description: event.description,
        scheduled_start_time: event.startsAt.toISOString(),
        scheduled_end_time: event.endsAt.toISOString(),
        privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
        entity_type: GuildScheduledEventEntityType.External,
        entity_metadata: { location: "Azeroth" },
      };
      await rest.post(Routes.guildScheduledEvents(guildId), { body });
    },
  };
}
