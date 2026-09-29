import type { JobRunStore } from "@nozdormu/core";
import { eq, lt } from "drizzle-orm";
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
    // before the cutoff. Postgres re-checks that condition against the latest row when two claims
    // race, so only one of them returns a row.
    claimRun: async (jobName, startedAt, cutoff) => {
      const rows = await db
        .insert(jobRuns)
        .values({ jobName, lastStartedAt: startedAt })
        .onConflictDoUpdate({
          target: jobRuns.jobName,
          set: { lastStartedAt: startedAt },
          setWhere: lt(jobRuns.lastStartedAt, cutoff),
        })
        .returning({ jobName: jobRuns.jobName });
      return rows.length === 1;
    },
  };
}
