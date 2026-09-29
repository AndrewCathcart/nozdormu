import { calendarReminders, type Database } from "@nozdormu/db";

// The reminders the news channel has had, by key.
export interface PostedReminderStore {
  readonly postedKeys: () => Promise<Set<string>>;
  readonly markPosted: (key: string) => Promise<void>;
}

export function createPostedReminderStore(db: Database): PostedReminderStore {
  return {
    postedKeys: async () => {
      const rows = await db.select({ key: calendarReminders.key }).from(calendarReminders);
      return new Set(rows.map((row) => row.key));
    },
    markPosted: async (key) => {
      await db.insert(calendarReminders).values({ key }).onConflictDoNothing();
    },
  };
}
