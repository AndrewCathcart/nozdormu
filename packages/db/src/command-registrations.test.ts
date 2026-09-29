import { describe, expect, it } from "vitest";
import { createCommandRegistrationStore } from "./command-registrations.ts";
import { useTestDatabase } from "./testing.ts";

const database = useTestDatabase();
const devApp = "100000000000000001";
const prodApp = "100000000000000002";

describe("command registration store", () => {
  it("returns the hash recorded for an application in a server", async () => {
    const store = createCommandRegistrationStore(database.db);
    const target = { applicationId: devApp, guildId: "200000000000000001" };

    await store.record({ ...target, definitionsHash: "hash-a" });

    expect(await store.lastHash(target)).toBe("hash-a");
  });

  it("keeps only the latest registration for an application in a server", async () => {
    const store = createCommandRegistrationStore(database.db);
    const target = { applicationId: devApp, guildId: "200000000000000002" };

    await store.record({ ...target, definitionsHash: "hash-a" });
    await store.record({ ...target, definitionsHash: "hash-b" });

    expect(await store.lastHash(target)).toBe("hash-b");
  });

  it("keeps different applications in the same server apart", async () => {
    const store = createCommandRegistrationStore(database.db);
    const guildId = "200000000000000003";

    await store.record({ applicationId: devApp, guildId, definitionsHash: "dev-hash" });

    expect(await store.lastHash({ applicationId: prodApp, guildId })).toBeUndefined();
  });

  it("has no hash for a server that was never registered", async () => {
    const store = createCommandRegistrationStore(database.db);

    expect(
      await store.lastHash({ applicationId: devApp, guildId: "200000000000000004" }),
    ).toBeUndefined();
  });
});
