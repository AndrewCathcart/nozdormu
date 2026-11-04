import { channelCountdowns, type Database } from "@nozdormu/db";
import { eq } from "drizzle-orm";
import type { ChannelCountdownStore } from "./channel-countdown.ts";

export function createChannelCountdownStore(db: Database): ChannelCountdownStore {
  return {
    countdownOf: async (channelId) => {
      const [row] = await db
        .select({
          originalName: channelCountdowns.originalName,
          shownName: channelCountdowns.shownName,
        })
        .from(channelCountdowns)
        .where(eq(channelCountdowns.channelId, channelId));
      return row === undefined
        ? undefined
        : { originalName: row.originalName, shownName: row.shownName ?? undefined };
    },
    start: async (channelId, originalName) => {
      await db.insert(channelCountdowns).values({ channelId, originalName }).onConflictDoNothing();
    },
    markShown: async (channelId, shownName) => {
      await db
        .update(channelCountdowns)
        .set({ shownName })
        .where(eq(channelCountdowns.channelId, channelId));
    },
    finish: async (channelId) => {
      await db.delete(channelCountdowns).where(eq(channelCountdowns.channelId, channelId));
    },
  };
}
