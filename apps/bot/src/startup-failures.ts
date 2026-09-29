import { DiscordAPIError } from "discord.js";

// Turns Discord's rejection of a well-formed but wrong setting into a message naming that setting.
export function explainDiscordRejection(error: unknown): string | undefined {
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

const unreachableCodes = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH"]);

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

// Turns a failure to connect to Postgres into a message naming DATABASE_URL, without repeating it.
export function explainDatabaseFailure(error: unknown): string | undefined {
  const code = errorCode(error);
  if (code !== undefined && unreachableCodes.has(code)) {
    return "Couldn't reach the database server in DATABASE_URL.";
  }
  if (code === "3D000") {
    return "The database named in DATABASE_URL doesn't exist.";
  }
  if (code === "28P01" || code === "28000") {
    return "The database server rejected the user or password in DATABASE_URL.";
  }
  return undefined;
}
