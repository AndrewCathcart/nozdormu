import { DiscordAPIError } from "discord.js";

// Turns Discord's rejection of a well-formed but wrong setting into a message naming that setting.
export function explainRejectedSetting(error: unknown): string | undefined {
  if (!(error instanceof DiscordAPIError)) {
    return undefined;
  }
  if (error.status === 401) {
    return "Discord rejected DISCORD_TOKEN.";
  }
  if (error.code === 50001) {
    return "The bot can't access the server in DISCORD_GUILD_ID. Check the ID, and that the bot has been added to that server.";
  }
  if (error.code === 10002) {
    return "Discord doesn't know the application in DISCORD_APPLICATION_ID. Check it matches the bot's token.";
  }
  return undefined;
}
