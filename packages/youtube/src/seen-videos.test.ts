import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import { createSeenVideoStore } from "./seen-videos.ts";

const database = useTestDatabase();

const older = { id: "aaaaaaaaaaa", publishedAt: new Date("2026-09-26T10:00:00Z") };
const newer = { id: "bbbbbbbbbbb", publishedAt: new Date("2026-09-27T10:00:00Z") };

describe("seen video store", () => {
  it("records the first check with the videos already on the channel", async () => {
    const store = createSeenVideoStore(database.db);

    await store.recordFirstCheck("UC0000000000000000000001", [newer, older]);

    expect(await store.history("UC0000000000000000000001")).toEqual({
      firstCheckDone: true,
      seenIds: new Set(["aaaaaaaaaaa", "bbbbbbbbbbb"]),
      newestPublishedAt: new Date("2026-09-27T10:00:00Z"),
    });
  });

  it("remembers nothing about a channel it has never checked", async () => {
    const store = createSeenVideoStore(database.db);

    expect(await store.history("UC0000000000000000000002")).toEqual({
      firstCheckDone: false,
      seenIds: new Set(),
      newestPublishedAt: undefined,
    });
  });

  it("counts a first check that found no videos", async () => {
    const store = createSeenVideoStore(database.db);

    await store.recordFirstCheck("UC0000000000000000000003", []);

    expect((await store.history("UC0000000000000000000003")).firstCheckDone).toBe(true);
  });

  it("adds seen videos and moves the newest publish time forward", async () => {
    const store = createSeenVideoStore(database.db);
    await store.recordFirstCheck("UC0000000000000000000004", [older]);

    await store.markSeen("UC0000000000000000000004", [newer]);

    expect(await store.history("UC0000000000000000000004")).toEqual({
      firstCheckDone: true,
      seenIds: new Set(["aaaaaaaaaaa", "bbbbbbbbbbb"]),
      newestPublishedAt: new Date("2026-09-27T10:00:00Z"),
    });
  });

  it("ignores a video marked as seen twice", async () => {
    const store = createSeenVideoStore(database.db);
    await store.recordFirstCheck("UC0000000000000000000005", [older]);

    await store.markSeen("UC0000000000000000000005", [older, newer]);

    expect((await store.history("UC0000000000000000000005")).seenIds).toEqual(
      new Set(["aaaaaaaaaaa", "bbbbbbbbbbb"]),
    );
  });

  it("keeps channels apart", async () => {
    const store = createSeenVideoStore(database.db);
    await store.recordFirstCheck("UC0000000000000000000006", [newer]);

    expect((await store.history("UC0000000000000000000007")).seenIds).toEqual(new Set());
  });
});
