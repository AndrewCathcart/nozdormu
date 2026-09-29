import type { LogFn, Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type JobRunStore,
  type ScheduledJob,
  type SchedulerDeps,
  startScheduler,
} from "./scheduler.ts";
import type { WeeklyTime } from "./weekly-time.ts";

const minute = 60_000;
const start = new Date("2026-09-29T12:00:00Z");

// An in-memory JobRunStore with the same claim rule as the Postgres one: a run can be claimed if
// the job never ran, or its last run started before the cutoff.
function createFakeStore(lastRuns: Record<string, Date> = {}) {
  const runs = new Map(Object.entries(lastRuns));
  return {
    runs,
    lastRunAt: (jobName) => Promise.resolve(runs.get(jobName)),
    claimRun: (jobName, startedAt, cutoff) => {
      const last = runs.get(jobName);
      if (last !== undefined && last.getTime() >= cutoff.getTime()) {
        return Promise.resolve(false);
      }
      runs.set(jobName, startedAt);
      return Promise.resolve(true);
    },
  } satisfies JobRunStore & { readonly runs: Map<string, Date> };
}

function createFakeLogger() {
  return { info: vi.fn<LogFn>(), error: vi.fn<LogFn>() } satisfies Pick<Logger, "info" | "error">;
}

function createJob(name: string, intervalMs: number) {
  return {
    name,
    intervalMs,
    run: vi.fn<ScheduledJob["run"]>().mockResolvedValue(undefined),
  } satisfies ScheduledJob;
}

// Mondays at 09:00 UK time. The tests start on Tuesday 29 September 2026, during British Summer
// Time, so the next one is Monday 5 October at 08:00 UTC.
const mondayMorning = {
  day: "monday",
  hour: 9,
  minute: 0,
  timeZone: "Europe/London",
} satisfies WeeklyTime;
const nextMondayMorning = new Date("2026-10-05T08:00:00Z");
const lastMondayMorning = new Date("2026-09-28T08:00:00Z");

function createWeeklyJob(name: string, weekly: WeeklyTime) {
  return {
    name,
    weekly,
    run: vi.fn<ScheduledJob["run"]>().mockResolvedValue(undefined),
  } satisfies ScheduledJob;
}

// Moves the fake clock forward to the given moment.
async function advanceTo(moment: Date): Promise<void> {
  await vi.advanceTimersByTimeAsync(moment.getTime() - Date.now());
}

function jobTaking(durationMs: number): () => Promise<undefined> {
  return () =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve(undefined);
      }, durationMs);
    });
}

function startWith(jobs: readonly ScheduledJob[], deps: Partial<SchedulerDeps> = {}) {
  const fullDeps = {
    store: createFakeStore(),
    logger: createFakeLogger(),
    stopTimeoutMs: minute,
    ...deps,
  };
  return startScheduler(jobs, fullDeps);
}

beforeEach(() => {
  vi.useFakeTimers({ now: start });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startScheduler", () => {
  it("runs a job that has never run as soon as it starts", async () => {
    const job = createJob("poll", 10 * minute);

    const scheduler = startWith([job]);
    await vi.advanceTimersByTimeAsync(0);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("runs a job whose next run fell due while the bot was down as soon as it starts", async () => {
    const job = createJob("poll", 10 * minute);
    const store = createFakeStore({ poll: new Date(start.getTime() - 25 * minute) });

    const scheduler = startWith([job], { store });
    await vi.advanceTimersByTimeAsync(0);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("waits until one interval after the last run when the job ran recently", async () => {
    const job = createJob("poll", 10 * minute);
    const store = createFakeStore({ poll: new Date(start.getTime() - 4 * minute) });

    const scheduler = startWith([job], { store });
    await vi.advanceTimersByTimeAsync(6 * minute - 1);
    expect(job.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("runs the job again every interval", async () => {
    const job = createJob("poll", 10 * minute);

    const scheduler = startWith([job]);
    await vi.advanceTimersByTimeAsync(20 * minute);

    expect(job.run).toHaveBeenCalledTimes(3);
    await scheduler.stop();
  });

  it("keeps running a job on schedule after a run fails", async () => {
    const job = createJob("poll", 10 * minute);
    job.run.mockRejectedValueOnce(new Error("Feed is down"));

    const scheduler = startWith([job]);
    await vi.advanceTimersByTimeAsync(10 * minute);

    expect(job.run).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("logs a run that fails", async () => {
    const job = createJob("poll", 10 * minute);
    job.run.mockRejectedValueOnce(new Error("Feed is down"));
    const logger = createFakeLogger();

    const scheduler = startWith([job], { logger });
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "job.failed", job: "poll", err: new Error("Feed is down") },
      "Scheduled job failed",
    );
    await scheduler.stop();
  });

  it("doesn't let one failing job stop another", async () => {
    const failing = createJob("poll", 10 * minute);
    failing.run.mockRejectedValue(new Error("Feed is down"));
    const healthy = createJob("check", 10 * minute);

    const scheduler = startWith([failing, healthy]);
    await vi.advanceTimersByTimeAsync(10 * minute);

    expect(healthy.run).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("logs how long each run took", async () => {
    const job = createJob("poll", 10 * minute);
    job.run.mockImplementation(jobTaking(1500));
    const logger = createFakeLogger();

    const scheduler = startWith([job], { logger });
    await vi.advanceTimersByTimeAsync(1500);

    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "job.finished", job: "poll", durationMs: 1500 },
      "Scheduled job finished",
    );
    await scheduler.stop();
  });

  it("never starts a job again while its previous run is still going", async () => {
    const job = createJob("poll", 10 * minute);
    job.run.mockImplementation(jobTaking(15 * minute));

    const scheduler = startWith([job]);
    await vi.advanceTimersByTimeAsync(15 * minute - 1);
    expect(job.run).toHaveBeenCalledOnce();
    // The next run starts as soon as this one ends (Node runs a zero-delay timer after 1 ms).
    await vi.advanceTimersByTimeAsync(2);

    expect(job.run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15 * minute);
    await scheduler.stop();
  });

  it("starts no more runs once stopped", async () => {
    const job = createJob("poll", 10 * minute);
    const scheduler = startWith([job]);
    await vi.advanceTimersByTimeAsync(5 * minute);

    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(30 * minute);

    expect(job.run).toHaveBeenCalledOnce();
  });

  it("lets a run in progress finish before stop resolves", async () => {
    const job = createJob("poll", 10 * minute);
    const run = Promise.withResolvers<undefined>();
    job.run.mockReturnValue(run.promise);
    const scheduler = startWith([job]);
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;

    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(stopped).toBe(false);
    run.resolve(undefined);
    await stopping;
  });

  it("refuses two jobs with the same name", () => {
    expect(() => startWith([createJob("poll", minute), createJob("poll", minute)])).toThrow(
      new Error("The job poll is defined more than once."),
    );
  });
  it("records a run when it starts, before the job finishes", async () => {
    const job = createJob("poll", 10 * minute);
    job.run.mockImplementation(jobTaking(5 * minute));
    const store = createFakeStore();

    const scheduler = startWith([job], { store });
    await vi.advanceTimersByTimeAsync(minute);

    expect(store.runs.get("poll")).toEqual(start);
    await vi.advanceTimersByTimeAsync(5 * minute);
    await scheduler.stop();
  });
  it("skips a run another process already started, and waits until the job is next due", async () => {
    const job = createJob("poll", 10 * minute);
    const store = createFakeStore();
    // Another process starts the run between our lookup and our claim.
    const racedStore = {
      ...store,
      claimRun: vi.fn<JobRunStore["claimRun"]>().mockImplementationOnce(() => {
        store.runs.set("poll", start);
        return Promise.resolve(false);
      }),
    };
    racedStore.claimRun.mockImplementation(store.claimRun);

    const scheduler = startWith([job], { store: racedStore });
    await vi.advanceTimersByTimeAsync(10 * minute - 1);
    expect(job.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });
  it("doesn't run a job whose run can't be claimed, and tries again an interval later", async () => {
    const job = createJob("poll", 10 * minute);
    const store = createFakeStore();
    const flakyStore = {
      ...store,
      claimRun: vi
        .fn<JobRunStore["claimRun"]>()
        .mockRejectedValueOnce(new Error("Database is down")),
    };
    flakyStore.claimRun.mockImplementation(store.claimRun);

    const scheduler = startWith([job], { store: flakyStore });
    await vi.advanceTimersByTimeAsync(10 * minute - 1);
    expect(job.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("logs a run that can't be claimed", async () => {
    const job = createJob("poll", 10 * minute);
    const claimError = new Error("Database is down");
    const store = { ...createFakeStore(), claimRun: () => Promise.reject(claimError) };
    const logger = createFakeLogger();

    const scheduler = startWith([job], { store, logger });
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "job.claim_failed", job: "poll", err: claimError },
      "Couldn't claim a scheduled job's run, so it didn't run",
    );
    await scheduler.stop();
  });
  it("checks a job whose last run is recorded in the future once per interval, not in a tight loop", async () => {
    const job = createJob("poll", 10 * minute);
    const store = createFakeStore({ poll: new Date(start.getTime() + 45 * 24 * 60 * minute) });
    const watchedStore = { ...store, claimRun: vi.fn<JobRunStore["claimRun"]>(store.claimRun) };

    const scheduler = startWith([job], { store: watchedStore });
    await vi.advanceTimersByTimeAsync(30 * minute);

    expect(watchedStore.claimRun).toHaveBeenCalledTimes(3);
    expect(job.run).not.toHaveBeenCalled();
    await scheduler.stop();
  });
  it("tries a job straight away when its last run can't be looked up, and lets the claim decide", async () => {
    const job = createJob("poll", 10 * minute);
    const store = {
      ...createFakeStore(),
      lastRunAt: () => Promise.reject(new Error("Database is down")),
    };

    const scheduler = startWith([job], { store });
    await vi.advanceTimersByTimeAsync(0);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("logs a last run that can't be looked up", async () => {
    const job = createJob("poll", 10 * minute);
    const lookupError = new Error("Database is down");
    const store = { ...createFakeStore(), lastRunAt: () => Promise.reject(lookupError) };
    const logger = createFakeLogger();

    const scheduler = startWith([job], { store, logger });
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "job.lookup_failed", job: "poll", err: lookupError },
      "Couldn't look up when a scheduled job last ran",
    );
    await scheduler.stop();
  });
  it("stops waiting for a hung run once the stop timeout passes", async () => {
    const job = createJob("poll", 10 * minute);
    job.run.mockReturnValue(new Promise(() => undefined));
    const scheduler = startWith([job], { stopTimeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;

    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(stopped).toBe(true);
    await stopping;
  });

  it("logs the runs it stopped waiting for", async () => {
    const job = createJob("poll", 10 * minute);
    job.run.mockReturnValue(new Promise(() => undefined));
    const logger = createFakeLogger();
    const scheduler = startWith([job], { stopTimeoutMs: 5000, logger });
    await vi.advanceTimersByTimeAsync(0);

    const stopping = scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await stopping;

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "scheduler.stop_timed_out", jobs: ["poll"] },
      "Stopped without waiting for scheduled jobs still running",
    );
  });
  it("waits for a startup lookup still in progress before stop resolves", async () => {
    const job = createJob("poll", 10 * minute);
    const lookup = Promise.withResolvers<Date | undefined>();
    const store = { ...createFakeStore(), lastRunAt: () => lookup.promise };
    const scheduler = startWith([job], { store });
    let stopped = false;

    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(stopped).toBe(false);
    lookup.resolve(undefined);
    await stopping;
  });

  it("runs nothing when a startup lookup finishes after stopping", async () => {
    const job = createJob("poll", 10 * minute);
    const lookup = Promise.withResolvers<Date | undefined>();
    const store = { ...createFakeStore(), lastRunAt: () => lookup.promise };
    const scheduler = startWith([job], { store });

    const stopping = scheduler.stop();
    lookup.resolve(undefined);
    await stopping;
    await vi.advanceTimersByTimeAsync(30 * minute);

    expect(job.run).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, Number.NaN, 30 * 24 * 60 * minute])(
    "refuses an interval of %s ms",
    (intervalMs) => {
      expect(() => startWith([createJob("poll", intervalMs)])).toThrow(
        new Error(
          `The job poll has an interval of ${String(intervalMs)} ms; it must be a whole number of milliseconds from 1 to 2147483647.`,
        ),
      );
    },
  );
  it("logs a run that's still going one interval after it started", async () => {
    const job = createJob("poll", 10 * minute);
    job.run.mockImplementation(jobTaking(25 * minute));
    const logger = createFakeLogger();

    const scheduler = startWith([job], { logger });
    await vi.advanceTimersByTimeAsync(10 * minute);

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "job.overrunning", job: "poll", runningMs: 10 * minute },
      "A scheduled job is still running when its next run is due",
    );
    await vi.advanceTimersByTimeAsync(15 * minute);
    await scheduler.stop();
  });
  it("doesn't start a run whose claim comes back after stopping", async () => {
    const job = createJob("poll", 10 * minute);
    const store = createFakeStore();
    const claim = Promise.withResolvers<boolean>();
    const slowStore = { ...store, claimRun: () => claim.promise };
    const scheduler = startWith([job], { store: slowStore });
    await vi.advanceTimersByTimeAsync(0);

    const stopping = scheduler.stop();
    claim.resolve(true);
    await stopping;

    expect(job.run).not.toHaveBeenCalled();
  });

  it("leaves no timers behind once stopped", async () => {
    const job = createJob("poll", 10 * minute);
    const run = Promise.withResolvers<undefined>();
    job.run.mockReturnValue(run.promise);
    const scheduler = startWith([job]);
    await vi.advanceTimersByTimeAsync(0);

    const stopping = scheduler.stop();
    run.resolve(undefined);
    await stopping;

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("startScheduler with a weekly job", () => {
  it("runs the job at its next weekly time, not when the scheduler starts", async () => {
    const job = createWeeklyJob("paper", mondayMorning);

    const scheduler = startWith([job]);
    await advanceTo(new Date(nextMondayMorning.getTime() - 1));
    expect(job.run).not.toHaveBeenCalled();
    await advanceTo(nextMondayMorning);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("runs the job as soon as it starts when its latest weekly time passed while the bot was down", async () => {
    const job = createWeeklyJob("paper", mondayMorning);
    const store = createFakeStore({ paper: new Date("2026-09-21T08:00:00Z") });

    const scheduler = startWith([job], { store });
    await vi.advanceTimersByTimeAsync(0);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("waits for next week's time when the job already ran this week", async () => {
    const job = createWeeklyJob("paper", mondayMorning);
    const store = createFakeStore({ paper: new Date(lastMondayMorning.getTime() + 1000) });

    const scheduler = startWith([job], { store });
    await advanceTo(new Date(nextMondayMorning.getTime() - 1));
    expect(job.run).not.toHaveBeenCalled();
    await advanceTo(nextMondayMorning);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("runs the job every week at the local time, even when the clocks go back", async () => {
    const job = createWeeklyJob("paper", mondayMorning);
    // The clocks go back on Sunday 25 October, so that Monday's 09:00 is 09:00 UTC, not 08:00.
    const mondayAfterClocksGoBack = new Date("2026-10-26T09:00:00Z");

    const scheduler = startWith([job]);
    await advanceTo(new Date(mondayAfterClocksGoBack.getTime() - 1));
    expect(job.run).toHaveBeenCalledTimes(3);
    await advanceTo(mondayAfterClocksGoBack);

    expect(job.run).toHaveBeenCalledTimes(4);
    await scheduler.stop();
  });

  it("runs the job once a week even when two processes schedule it", async () => {
    const store = createFakeStore();
    const inOldProcess = createWeeklyJob("paper", mondayMorning);
    const inNewProcess = createWeeklyJob("paper", mondayMorning);

    const schedulers = [startWith([inOldProcess], { store }), startWith([inNewProcess], { store })];
    await advanceTo(nextMondayMorning);

    expect(inOldProcess.run.mock.calls.length + inNewProcess.run.mock.calls.length).toBe(1);
    await Promise.all(schedulers.map((scheduler) => scheduler.stop()));
  });

  it("tries again a minute later when the run can't be claimed, so the week isn't lost", async () => {
    const job = createWeeklyJob("paper", mondayMorning);
    const store = createFakeStore();
    const flakyStore = {
      ...store,
      claimRun: vi
        .fn<JobRunStore["claimRun"]>()
        .mockRejectedValueOnce(new Error("Database is down")),
    };
    flakyStore.claimRun.mockImplementation(store.claimRun);

    const scheduler = startWith([job], { store: flakyStore });
    await advanceTo(new Date(nextMondayMorning.getTime() + minute - 1));
    expect(job.run).not.toHaveBeenCalled();
    await advanceTo(new Date(nextMondayMorning.getTime() + minute));

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it.each([
    ["one that doesn't exist", "Europe/Atlantis"],
    ["a fixed offset, which never follows daylight saving", "+01:00"],
  ])("refuses a time zone that's %s", (_kind, timeZone) => {
    const job = createWeeklyJob("paper", { ...mondayMorning, timeZone });

    expect(() => startWith([job])).toThrow(
      new Error(
        `The job paper can't run weekly: the time zone "${timeZone}" isn't an IANA time zone.`,
      ),
    );
  });

  it.each([
    [24, 0, "hour 24, minute 0"],
    [-1, 0, "hour -1, minute 0"],
    [9, 60, "hour 9, minute 60"],
    [9.5, 0, "hour 9.5, minute 0"],
  ])("refuses a time of %s hours and %s minutes", (hour, minutes, described) => {
    const job = createWeeklyJob("paper", { ...mondayMorning, hour, minute: minutes });

    expect(() => startWith([job])).toThrow(
      new Error(
        `The job paper can't run weekly: ${described} isn't a time of day (the hour must be a whole number from 0 to 23, and the minute from 0 to 59).`,
      ),
    );
  });

  it("logs a run still going when next week's run is due", async () => {
    const job = createWeeklyJob("paper", mondayMorning);
    const run = Promise.withResolvers<undefined>();
    job.run.mockReturnValue(run.promise);
    const logger = createFakeLogger();
    const week = 7 * 24 * 60 * minute;

    const scheduler = startWith([job], { logger });
    await advanceTo(new Date(nextMondayMorning.getTime() + week - 1));
    expect(logger.error).not.toHaveBeenCalled();
    await advanceTo(new Date(nextMondayMorning.getTime() + week));

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "job.overrunning", job: "paper", runningMs: week },
      "A scheduled job is still running when its next run is due",
    );
    run.resolve(undefined);
    await scheduler.stop();
  });

  it("runs a new job once when its timer fires a moment before the weekly time", async () => {
    const job = createWeeklyJob("paper", mondayMorning);
    const scheduler = startWith([job]);
    await advanceTo(new Date(nextMondayMorning.getTime() - 10));

    // Node's timers don't follow the wall clock exactly, so a timer can fire when Date.now() is
    // still a millisecond short of the time it was set for.
    vi.setSystemTime(new Date(Date.now() - 1));
    await vi.advanceTimersByTimeAsync(minute);

    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });

  it("looks up the last run again a minute later when it can't be looked up at startup", async () => {
    const job = createWeeklyJob("paper", mondayMorning);
    const store = createFakeStore();
    const flakyStore = {
      ...store,
      lastRunAt: vi
        .fn<JobRunStore["lastRunAt"]>()
        .mockRejectedValueOnce(new Error("Database is down")),
    };
    flakyStore.lastRunAt.mockImplementation(store.lastRunAt);

    const scheduler = startWith([job], { store: flakyStore });
    await vi.advanceTimersByTimeAsync(minute);

    expect(flakyStore.lastRunAt).toHaveBeenCalledTimes(2);
    expect(job.run).not.toHaveBeenCalled();
    await advanceTo(nextMondayMorning);
    expect(job.run).toHaveBeenCalledOnce();
    await scheduler.stop();
  });
});
