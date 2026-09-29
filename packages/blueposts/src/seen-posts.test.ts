import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import { createSeenPostStore } from "./seen-posts.ts";

const database = useTestDatabase();

function seenPost(id: number, createdAt: string) {
  return { id, createdAt: new Date(createdAt) };
}

// Each test uses its own feed, so tests don't see each other's posts.
describe("seen post store", () => {
  it("has no history for a feed it hasn't checked", async () => {
    const store = createSeenPostStore(database.db);

    expect(await store.history("never-checked")).toBeUndefined();
  });

  it("records the first check with the baseline given", async () => {
    const store = createSeenPostStore(database.db);

    await store.recordFirstCheck(
      "first-check",
      [seenPost(1, "2026-09-24T12:00:00Z")],
      new Date("2026-09-25T11:59:59.999Z"),
    );

    expect(await store.history("first-check")).toStrictEqual({
      baseline: new Date("2026-09-25T11:59:59.999Z"),
    });
  });

  it("records the posts there at the first check as seen", async () => {
    const store = createSeenPostStore(database.db);

    await store.recordFirstCheck(
      "first-posts",
      [seenPost(1, "2026-09-24T12:00:00Z")],
      new Date("2026-09-24T12:00:00Z"),
    );

    expect(await store.seenIds("first-posts", [1, 2])).toEqual(new Set([1]));
  });

  it("counts a first check with no posts and no baseline", async () => {
    const store = createSeenPostStore(database.db);

    await store.recordFirstCheck("empty-first-check", [], undefined);

    expect(await store.history("empty-first-check")).toStrictEqual({ baseline: undefined });
  });

  it("says which of some posts a feed has seen, ignoring other feeds'", async () => {
    const store = createSeenPostStore(database.db);
    await store.markSeen("one-feed", [5_000_001, 5_000_002]);
    await store.markSeen("another-feed", [5_000_003]);

    expect(await store.seenIds("one-feed", [5_000_002, 5_000_003])).toEqual(new Set([5_000_002]));
  });

  it("records a post it has already seen without failing", async () => {
    const store = createSeenPostStore(database.db);
    await store.markSeen("seen-twice", [5_000_005]);

    await store.markSeen("seen-twice", [5_000_005]);

    expect(await store.seenIds("seen-twice", [5_000_005])).toEqual(new Set([5_000_005]));
  });
});
