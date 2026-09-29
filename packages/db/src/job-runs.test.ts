import { describe, expect, it } from "vitest";
import { createJobRunStore } from "./job-runs.ts";
import { useTestDatabase } from "./testing.ts";

const database = useTestDatabase();

describe("job run store", () => {
  it("claims a job that never ran, and records when that run started", async () => {
    const store = createJobRunStore(database.db);

    const claimed = await store.claimRun(
      "first.run",
      new Date("2026-09-29T12:00:00Z"),
      new Date("2026-09-29T11:50:00Z"),
    );

    expect(claimed).toBe(true);
    expect(await store.lastRunAt("first.run")).toEqual(new Date("2026-09-29T12:00:00Z"));
  });
  it("claims a job whose last run started before the cutoff", async () => {
    const store = createJobRunStore(database.db);
    await store.claimRun("due.job", new Date("2026-09-29T12:00:00Z"), new Date(0));

    const claimed = await store.claimRun(
      "due.job",
      new Date("2026-09-29T12:10:00Z"),
      new Date("2026-09-29T12:00:00.001Z"),
    );

    expect(claimed).toBe(true);
    expect(await store.lastRunAt("due.job")).toEqual(new Date("2026-09-29T12:10:00Z"));
  });
  it("refuses a job whose last run started at the cutoff, and keeps its last run", async () => {
    const store = createJobRunStore(database.db);
    await store.claimRun("early.job", new Date("2026-09-29T12:00:00Z"), new Date(0));

    const claimed = await store.claimRun(
      "early.job",
      new Date("2026-09-29T12:05:00Z"),
      new Date("2026-09-29T12:00:00Z"),
    );

    expect(claimed).toBe(false);
    expect(await store.lastRunAt("early.job")).toEqual(new Date("2026-09-29T12:00:00Z"));
  });

  it("never moves a job's last run backwards", async () => {
    const store = createJobRunStore(database.db);
    await store.claimRun("late.writer", new Date("2026-09-29T13:00:00Z"), new Date(0));

    await store.claimRun(
      "late.writer",
      new Date("2026-09-29T12:00:00Z"),
      new Date("2026-09-29T11:50:00.001Z"),
    );

    expect(await store.lastRunAt("late.writer")).toEqual(new Date("2026-09-29T13:00:00Z"));
  });

  it("lets only one of two simultaneous claims through", async () => {
    const store = createJobRunStore(database.db);
    await store.claimRun("raced.job", new Date("2026-09-29T12:00:00Z"), new Date(0));
    const startedAt = new Date("2026-09-29T12:10:00Z");
    const cutoff = new Date("2026-09-29T12:00:00.001Z");

    const claims = await Promise.all([
      store.claimRun("raced.job", startedAt, cutoff),
      store.claimRun("raced.job", startedAt, cutoff),
    ]);

    expect(claims.toSorted()).toEqual([false, true]);
  });

  it("has no last run for a job that never ran", async () => {
    const store = createJobRunStore(database.db);

    expect(await store.lastRunAt("never.ran")).toBeUndefined();
  });
});
