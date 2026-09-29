import { serializeError } from "@nozdormu/core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTestDatabase } from "./testing.ts";

const database = useTestDatabase();

// serializeError against real Postgres errors, which can repeat the values they reject.
describe("serializeError with Postgres errors", () => {
  it("never keeps a value that Postgres repeats in a rejected-value error", async () => {
    const rejection: unknown = await database.db
      .execute(sql`select ${"Made-up chat message"}::int`)
      .then(
        () => new Error("The query was expected to fail, but it succeeded."),
        (error: unknown) => error,
      );

    const serialized = serializeError(rejection);

    expect(serialized.cause?.message).toBe("Postgres rejected a value (SQLSTATE 22P02).");
    expect(JSON.stringify(serialized)).not.toContain("Made-up chat message");
  });
});
