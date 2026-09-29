import type { Feature } from "@nozdormu/core";

export function createPingFeature(): Feature {
  return {
    commands: [
      {
        definition: { name: "ping", description: "Check that the bot is alive." },
        handle: () => Promise.resolve({ content: "Pong!" }),
      },
    ],
  };
}
