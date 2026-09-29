import { DiscordAPIError } from "discord.js";
import { describe, expect, it } from "vitest";
import { explainDatabaseFailure, explainDiscordRejection } from "./startup-failures.ts";

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

describe("explainDiscordRejection", () => {
  it("blames the token when Discord answers 401", () => {
    expect(explainDiscordRejection(registrationError(0, 401, "401: Unauthorized"))).toBe(
      "Discord rejected DISCORD_TOKEN.",
    );
  });

  it("blames the server ID when Discord answers Missing Access", () => {
    expect(explainDiscordRejection(registrationError(50001, 403, "Missing Access"))).toBe(
      "The bot can't access the server in DISCORD_GUILD_ID. Check the ID, and that the bot has been added to that server.",
    );
  });

  it("blames the application ID when Discord answers Unknown Application", () => {
    expect(explainDiscordRejection(registrationError(10002, 404, "Unknown Application"))).toBe(
      "Discord doesn't know the application in DISCORD_APPLICATION_ID. Check it matches the bot's token.",
    );
  });

  it("leaves other Discord errors unexplained", () => {
    expect(
      explainDiscordRejection(registrationError(0, 500, "500: Internal Server Error")),
    ).toBeUndefined();
  });
});

// The shape postgres.js gives server errors: an Error named PostgresError with a SQLSTATE code.
function postgresError(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: "PostgresError", severity: "FATAL", code });
}

describe("explainDatabaseFailure", () => {
  it("blames the server address when the connection is refused", () => {
    const refused = Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });

    expect(explainDatabaseFailure(refused)).toBe(
      "Couldn't reach the database server in DATABASE_URL.",
    );
  });

  it("blames the database name when Postgres says it doesn't exist", () => {
    const missing = postgresError("3D000", 'database "made_up_database" does not exist');

    expect(explainDatabaseFailure(missing)).toBe(
      "The database named in DATABASE_URL doesn't exist.",
    );
  });
  it("blames the user or password when Postgres rejects them", () => {
    const rejected = postgresError(
      "28P01",
      'password authentication failed for user "made_up_user"',
    );

    expect(explainDatabaseFailure(rejected)).toBe(
      "The database server rejected the user or password in DATABASE_URL.",
    );
  });

  it("leaves other database errors unexplained", () => {
    const other = postgresError("53200", "out of memory");

    expect(explainDatabaseFailure(other)).toBeUndefined();
  });
});
