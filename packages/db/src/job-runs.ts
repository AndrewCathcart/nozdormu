import type { JobRunStore } from "@nozdormu/core";
import { eq, lte } from "drizzle-orm";
import type { Database } from "./client.ts";
import { jobRuns } from "./schema.ts";

export function createJobRunStore(db: Database): JobRunStore {
  return {
    lastRunAt: async (jobName) => {
      const [row] = await db
        .select({ lastStartedAt: jobRuns.lastStartedAt })
        .from(jobRuns)
        .where(eq(jobRuns.jobName, jobName));
      return row?.lastStartedAt;
    },
    // One statement, so it's atomic: the row is inserted, or updated only if the stored run started
    // at least one interval before this one. Postgres re-checks that condition against the latest
    // row when two claims race, so only one of them returns a row.
    claimRun: async (jobName, startedAt, intervalMs) => {
      const dueIfStartedBy = new Date(startedAt.getTime() - intervalMs);
      const rows = await db
        .insert(jobRuns)
        .values({ jobName, lastStartedAt: startedAt })
        .onConflictDoUpdate({
          target: jobRuns.jobName,
          set: { lastStartedAt: startedAt },
          setWhere: lte(jobRuns.lastStartedAt, dueIfStartedBy),
        })
        .returning({ jobName: jobRuns.jobName });
      return rows.length === 1;
    },
  };
}
