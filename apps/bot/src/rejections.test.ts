import { DiscordAPIError } from "discord.js";
import { describe, expect, it } from "vitest";
import { explainRejectedSetting } from "./rejections.ts";

// Codes and statuses observed from Discord when registering commands with each setting wrong.
function registrationError(code: number, status: number, message: string): DiscordAPIError {
  return new DiscordAPIError(
    { code, message },
    code,
    status,
    "PUT",
    "https://discord.com/api/v10/applications/100000000000000001/guilds/200000000000000002/commands",
    { body: [] },
  );
}

describe("explainRejectedSetting", () => {
  it("blames the token when Discord answers 401", () => {
    expect(explainRejectedSetting(registrationError(0, 401, "401: Unauthorized"))).toBe(
      "Discord rejected DISCORD_TOKEN.",
    );
  });

  it("blames the server ID when Discord answers Missing Access", () => {
    expect(explainRejectedSetting(registrationError(50001, 403, "Missing Access"))).toBe(
      "The bot can't access the server in DISCORD_GUILD_ID. Check the ID, and that the bot has been added to that server.",
    );
  });

  it("blames the application ID when Discord answers Unknown Application", () => {
    expect(explainRejectedSetting(registrationError(10002, 404, "Unknown Application"))).toBe(
      "Discord doesn't know the application in DISCORD_APPLICATION_ID. Check it matches the bot's token.",
    );
  });

  it("leaves other Discord errors unexplained", () => {
    expect(
      explainRejectedSetting(registrationError(0, 500, "500: Internal Server Error")),
    ).toBeUndefined();
  });
});
