import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// The hash of the command definitions last registered for each application in each server, so
// startup only re-registers commands when they've changed.
export const commandRegistrations = pgTable(
  "command_registrations",
  {
    applicationId: text("application_id").notNull(),
    guildId: text("guild_id").notNull(),
    definitionsHash: text("definitions_hash").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.applicationId, table.guildId] })],
);

// When each scheduled job's latest run started. The scheduler claims a run by updating this
// row, so a restart knows when each job is next due and two processes can't run a job at once.
export const jobRuns = pgTable("job_runs", {
  jobName: text("job_name").primaryKey(),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }).notNull(),
});
