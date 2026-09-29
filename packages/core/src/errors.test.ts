import { DiscordAPIError } from "discord.js";
import { describe, expect, it } from "vitest";
import { serializeError } from "./errors.ts";

describe("serializeError", () => {
  it("keeps an error's type, message and stack", () => {
    const error = new Error("Kaboom");

    expect(serializeError(error)).toEqual({ type: "Error", message: "Kaboom", stack: error.stack });
  });

  it("keeps a Discord error's status and code, but never the request URL or body", () => {
    const error = new DiscordAPIError(
      { code: 10062, message: "Unknown interaction" },
      10062,
      404,
      "POST",
      "https://discord.com/api/v10/interactions/300000000000000003/made-up-interaction-token/callback",
      { body: { type: 4, data: { content: "Made-up reply text" } } },
    );

    expect(serializeError(error)).toEqual({
      type: "DiscordAPIError[10062]",
      message: "Unknown interaction",
      stack: error.stack,
      status: 404,
      code: 10062,
    });
  });

  it("describes a thrown non-error by its type only, never its contents", () => {
    expect(serializeError({ token: "made-up-token" })).toEqual({
      type: "object",
      message: "A non-error value was thrown.",
    });
  });
});
