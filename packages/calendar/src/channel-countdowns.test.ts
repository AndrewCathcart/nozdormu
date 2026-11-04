import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import { createChannelCountdownStore } from "./channel-countdowns.ts";

const database = useTestDatabase();

// Each test uses its own made-up channel, since they share one database.
describe("channel countdown store", () => {
  it("has no countdown for a channel that hasn't started one", async () => {
    const store = createChannelCountdownStore(database.db);

    expect(await store.countdownOf("300000000000000001")).toBeUndefined();
  });

  it("keeps the channel's usual name, then the countdown name it was given", async () => {
    const store = createChannelCountdownStore(database.db);
    await store.start("300000000000000002", "made-up-news");

    await store.markShown("300000000000000002", "⏳made-up-in-22h-50m");

    expect(await store.countdownOf("300000000000000002")).toEqual({
      originalName: "made-up-news",
      shownName: "⏳made-up-in-22h-50m",
    });
  });

  it("keeps the first usual name when started twice", async () => {
    const store = createChannelCountdownStore(database.db);
    await store.start("300000000000000003", "made-up-news");

    await store.start("300000000000000003", "⏳made-up-in-22h-50m");

    expect(await store.countdownOf("300000000000000003")).toEqual({
      originalName: "made-up-news",
      shownName: undefined,
    });
  });

  it("forgets the countdown once it's finished", async () => {
    const store = createChannelCountdownStore(database.db);
    await store.start("300000000000000004", "made-up-news");

    await store.finish("300000000000000004");

    expect(await store.countdownOf("300000000000000004")).toBeUndefined();
  });
});
