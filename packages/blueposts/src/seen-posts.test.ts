import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import { createSeenPostStore } from "./seen-posts.ts";

const database = useTestDatabase();

function seenPost(id: number, createdAt: string) {
  return { id, createdAt: new Date(createdAt) };
}

// Each test uses its own feed, so tests don't see each other's posts.
describe("seen post store", () => {
  it("has no first check or baseline for a feed it hasn't checked", async () => {
    const store = createSeenPostStore(database.db);

    expect(await store.history("never-checked")).toEqual({
      firstCheckDone: false,
      baseline: undefined,
    });
  });

  it("records the first check with the newest post's time as the baseline", async () => {
    const store = createSeenPostStore(database.db);

    await store.recordFirstCheck("first-check", [
      seenPost(1, "2026-09-24T12:00:00Z"),
      seenPost(2, "2026-09-25T12:00:00Z"),
    ]);

    expect(await store.history("first-check")).toEqual({
      firstCheckDone: true,
      baseline: new Date("2026-09-25T12:00:00Z"),
    });
  });

  it("records the posts there at the first check as seen", async () => {
    const store = createSeenPostStore(database.db);

    await store.recordFirstCheck("first-posts", [seenPost(1, "2026-09-24T12:00:00Z")]);

    expect(await store.seenIds("first-posts", [1, 2])).toEqual(new Set([1]));
  });

  it("counts a first check with no posts, with no baseline", async () => {
    const store = createSeenPostStore(database.db);

    await store.recordFirstCheck("empty-first-check", []);

    expect(await store.history("empty-first-check")).toEqual({
      firstCheckDone: true,
      baseline: undefined,
    });
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
