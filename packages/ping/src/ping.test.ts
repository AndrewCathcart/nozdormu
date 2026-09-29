import { assert, describe, expect, it } from "vitest";
import { createPingFeature } from "./ping.ts";

describe("/ping", () => {
  it('replies "Pong!"', async () => {
    const ping = createPingFeature().commands?.find(
      (command) => command.definition.name === "ping",
    );
    assert(ping, "The ping feature should define a /ping command.");

    const reply = await ping.handle({ commandName: "ping" });

    expect(reply).toEqual({ content: "Pong!" });
  });
});
