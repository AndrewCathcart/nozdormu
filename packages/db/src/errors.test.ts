import { serializeError } from "@nozdormu/core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTestDatabase } from "./testing.ts";

const database = useTestDatabase();

// serializeError against real Postgres errors, which can repeat the values they reject.
describe("serializeError with Postgres errors", () => {
  it("never keeps a value that Postgres repeats in a rejected-value error", async () => {
    const error: unknown = await database.db
      .execute(sql`select ${"Made-up chat message"}::int`)
      .then(
        () => undefined,
        (rejection: unknown) => rejection,
      );

    expect(JSON.stringify(serializeError(error))).not.toContain("Made-up chat message");
  });
});
