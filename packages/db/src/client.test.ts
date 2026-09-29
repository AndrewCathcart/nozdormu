import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runMigrations } from "./client.ts";
import { useTestDatabase } from "./testing.ts";

const database = useTestDatabase({ migrated: false });

// drizzle-kit's own record of the committed migrations.
const journal = z
  .object({ entries: z.array(z.object({ tag: z.string() })) })
  .parse(
    JSON.parse(readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8")),
  );

describe("runMigrations", () => {
  it("applies every committed migration once, and nothing on a second run", async () => {
    expect(await runMigrations(database.db)).toBe(journal.entries.length);
    expect(await runMigrations(database.db)).toBe(0);
  });
});
