import { describe, expect, it } from "vitest";
import { createJobRunStore } from "./job-runs.ts";
import { useTestDatabase } from "./testing.ts";

const database = useTestDatabase();
const minute = 60_000;

describe("job run store", () => {
  it("claims a job that never ran, and records when that run started", async () => {
    const store = createJobRunStore(database.db);

    const claimed = await store.claimRun(
      "first.run",
      new Date("2026-09-29T12:00:00Z"),
      10 * minute,
    );

    expect(claimed).toBe(true);
    expect(await store.lastRunAt("first.run")).toEqual(new Date("2026-09-29T12:00:00Z"));
  });
  it("claims a job whose last run started at least an interval earlier", async () => {
    const store = createJobRunStore(database.db);
    await store.claimRun("due.job", new Date("2026-09-29T12:00:00Z"), 10 * minute);

    const claimed = await store.claimRun("due.job", new Date("2026-09-29T12:10:00Z"), 10 * minute);

    expect(claimed).toBe(true);
    expect(await store.lastRunAt("due.job")).toEqual(new Date("2026-09-29T12:10:00Z"));
  });
  it("refuses a job that isn't due yet, and keeps its last run", async () => {
    const store = createJobRunStore(database.db);
    await store.claimRun("early.job", new Date("2026-09-29T12:00:00Z"), 10 * minute);

    const claimed = await store.claimRun(
      "early.job",
      new Date("2026-09-29T12:05:00Z"),
      10 * minute,
    );

    expect(claimed).toBe(false);
    expect(await store.lastRunAt("early.job")).toEqual(new Date("2026-09-29T12:00:00Z"));
  });

  it("never moves a job's last run backwards", async () => {
    const store = createJobRunStore(database.db);
    await store.claimRun("late.writer", new Date("2026-09-29T13:00:00Z"), 10 * minute);

    await store.claimRun("late.writer", new Date("2026-09-29T12:00:00Z"), 10 * minute);

    expect(await store.lastRunAt("late.writer")).toEqual(new Date("2026-09-29T13:00:00Z"));
  });

  it("lets only one of two simultaneous claims through", async () => {
    const store = createJobRunStore(database.db);
    await store.claimRun("raced.job", new Date("2026-09-29T12:00:00Z"), 10 * minute);
    const startedAt = new Date("2026-09-29T12:10:00Z");

    const claims = await Promise.all([
      store.claimRun("raced.job", startedAt, 10 * minute),
      store.claimRun("raced.job", startedAt, 10 * minute),
    ]);

    expect(claims.toSorted()).toEqual([false, true]);
  });

  it("has no last run for a job that never ran", async () => {
    const store = createJobRunStore(database.db);

    expect(await store.lastRunAt("never.ran")).toBeUndefined();
  });
});
