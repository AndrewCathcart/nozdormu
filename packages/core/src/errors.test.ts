import { DiscordAPIError } from "discord.js";
import { DrizzleQueryError } from "drizzle-orm";
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

  it("keeps a failed query's SQL but drops its parameter values everywhere", () => {
    const error = new DrizzleQueryError(
      "insert into messages (content) values ($1)",
      ["Made-up chat message"],
      new Error("Connection lost"),
    );

    const serialized = serializeError(error);

    expect(serialized.message).toBe("Failed query: insert into messages (content) values ($1)");
    expect(JSON.stringify(serialized)).not.toContain("Made-up chat message");
  });

  it("includes the error's cause, made safe the same way", () => {
    const cause = new Error("duplicate key value violates unique constraint");
    const error = new Error("Registration failed", { cause });

    expect(serializeError(error)).toEqual({
      type: "Error",
      message: "Registration failed",
      stack: error.stack,
      cause: {
        type: "Error",
        message: "duplicate key value violates unique constraint",
        stack: cause.stack,
      },
    });
  });

  it("stops at a cause that loops back to an error already serialized", () => {
    const error = new Error("Loops");
    error.cause = error;

    expect(serializeError(error)).toEqual({
      type: "Error",
      message: "Loops",
      stack: error.stack,
      cause: { type: "Error", message: "Circular cause omitted." },
    });
  });

  it("drops parameter values even when the SQL contains replacement patterns like $&", () => {
    const error = new DrizzleQueryError(
      "select '$&' as pattern where content = $1",
      ["Made-up chat message"],
      new Error("Connection lost"),
    );

    expect(JSON.stringify(serializeError(error))).not.toContain("Made-up chat message");
  });
});
