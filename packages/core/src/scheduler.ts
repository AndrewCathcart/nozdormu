import type { Logger } from "pino";
import {
  latestWeeklyTime,
  nextWeeklyTime,
  weeklyTimeProblem,
  type WeeklyTime,
} from "./weekly-time.ts";

interface JobBase {
  // Unique across all features, e.g. "youtube.poll". Run times are stored under this name.
  readonly name: string;
  readonly run: () => Promise<void>;
}

// Runs every intervalMs.
interface IntervalJob extends JobBase {
  readonly intervalMs: number;
  readonly weekly?: never;
}

// Runs once a week at a local time, such as Mondays at 09:00 in Europe/London.
interface WeeklyJob extends JobBase {
  readonly weekly: WeeklyTime;
  readonly intervalMs?: never;
}

export type ScheduledJob = IntervalJob | WeeklyJob;

export interface JobRunStore {
  readonly lastRunAt: (jobName: string) => Promise<Date | undefined>;
  // Records that a run starts at startedAt, but only if the job is due: it never ran, or its last
  // run started before the cutoff. Returns false when it isn't due, for example because another
  // process already started this run. Must be atomic across processes.
  readonly claimRun: (jobName: string, startedAt: Date, cutoff: Date) => Promise<boolean>;
}

export interface SchedulerDeps {
  readonly store: JobRunStore;
  readonly logger: Pick<Logger, "info" | "error">;
  // How long stop() waits for runs in progress before giving up on them.
  readonly stopTimeoutMs: number;
}

export interface Scheduler {
  // Starts no new runs, and resolves once runs in progress finish or stopTimeoutMs passes.
  readonly stop: () => Promise<void>;
}

// The longest delay setTimeout can hold. Anything longer fires after 1 ms instead.
const maxTimerDelayMs = 2_147_483_647;

// How soon a weekly job is tried again when the database can't claim its run or say when it last
// ran. Waiting a whole week would lose that week's run to a brief database outage.
const weeklyRetryMs = 60_000;

// When a job's runs are due. Built once per job, so the rest of the scheduler doesn't need to know
// whether it runs on an interval or weekly.
interface Timing {
  // Passed to claimRun: the job is due if its last run started before this.
  readonly claimCutoff: (startedAt: Date) => Date;
  // Milliseconds from now until the job is due, given when its last run started (undefined if it
  // never ran).
  readonly msUntilDue: (lastRunAt: Date | undefined, now: Date) => number;
  // Milliseconds from `from` until the job's next regular run: one interval, or its next weekly
  // time.
  readonly msUntilNextRun: (from: Date) => number;
  // How soon to try again when the claim itself fails.
  readonly claimRetryMs: number;
  // What to do at startup when the last run can't be looked up: try to claim a run straight away
  // and let the claim decide, or look again soon. A weekly job looks again, because a claim can't
  // tell a job that never ran (which should wait for its weekly time) from one that's due.
  readonly ifLastRunUnknown: "claim-now" | "look-again";
}

// Due one interval after the last run, to the millisecond: start times are whole milliseconds, so
// a last run before startedAt - intervalMs + 1 started at least an interval earlier. Never waits
// more than one interval, so a last run recorded in the future (a skewed clock) can't push the
// wait past what setTimeout can hold.
function intervalTiming(intervalMs: number): Timing {
  return {
    claimCutoff: (startedAt) => new Date(startedAt.getTime() - intervalMs + 1),
    msUntilDue: (lastRunAt, now) =>
      lastRunAt === undefined
        ? 0
        : Math.min(intervalMs, Math.max(0, lastRunAt.getTime() + intervalMs - now.getTime())),
    msUntilNextRun: () => intervalMs,
    claimRetryMs: intervalMs,
    ifLastRunUnknown: "claim-now",
  };
}

// Due if the job hasn't run since its latest weekly time. One that never ran waits for the next.
function weeklyTiming(time: WeeklyTime): Timing {
  const msUntilNextRun = (from: Date): number =>
    nextWeeklyTime(time, from).getTime() - from.getTime();
  return {
    claimCutoff: (startedAt) => latestWeeklyTime(time, startedAt),
    msUntilDue: (lastRunAt, now) =>
      lastRunAt !== undefined && lastRunAt.getTime() < latestWeeklyTime(time, now).getTime()
        ? 0
        : msUntilNextRun(now),
    msUntilNextRun,
    claimRetryMs: weeklyRetryMs,
    ifLastRunUnknown: "look-again",
  };
}

// Checks the job's schedule, naming the job and the problem if it can't be used.
function timingOf(job: ScheduledJob): Timing {
  if (job.weekly !== undefined) {
    const problem = weeklyTimeProblem(job.weekly);
    if (problem !== undefined) {
      throw new Error(`The job ${job.name} can't run weekly: ${problem}.`);
    }
    return weeklyTiming(job.weekly);
  }
  if (!Number.isInteger(job.intervalMs) || job.intervalMs < 1 || job.intervalMs > maxTimerDelayMs) {
    throw new Error(
      `The job ${job.name} has an interval of ${String(job.intervalMs)} ms; it must be a whole number of milliseconds from 1 to ${String(maxTimerDelayMs)}.`,
    );
  }
  return intervalTiming(job.intervalMs);
}

function timingsOf(jobs: readonly ScheduledJob[]): ReadonlyMap<ScheduledJob, Timing> {
  const timings = new Map<ScheduledJob, Timing>();
  const names = new Set<string>();
  for (const job of jobs) {
    if (names.has(job.name)) {
      throw new Error(`The job ${job.name} is defined more than once.`);
    }
    names.add(job.name);
    timings.set(job, timingOf(job));
  }
  return timings;
}

// Runs each job on its own interval or at its weekly time. A run is claimed in the store before it
// starts, so a job never runs twice at once, even across processes during a deploy, and a run that
// dies halfway isn't repeated straight away.
export function startScheduler(jobs: readonly ScheduledJob[], deps: SchedulerDeps): Scheduler {
  const timings = timingsOf(jobs);

  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  // Work in progress (startup lookups and runs), by the name of the job it belongs to.
  const inProgress = new Map<Promise<void>, string>();

  const track = (job: ScheduledJob, work: Promise<void>): void => {
    inProgress.set(work, job.name);
    void work.finally(() => inProgress.delete(work));
  };

  // Resolves to the last run, or to "unknown" (logged) when the store can't say.
  const lookUpLastRun = async (job: ScheduledJob): Promise<Date | undefined | "unknown"> => {
    try {
      return await deps.store.lastRunAt(job.name);
    } catch (error) {
      deps.logger.error(
        { event: "job.lookup_failed", job: job.name, err: error },
        "Couldn't look up when a scheduled job last ran",
      );
      return "unknown";
    }
  };

  const runJob = async (job: ScheduledJob, timing: Timing, startedAt: Date): Promise<void> => {
    // Once the next run is due, another process could claim it while this one still runs.
    const overrunMs = timing.msUntilNextRun(startedAt);
    const overrunning = setTimeout(() => {
      deps.logger.error(
        { event: "job.overrunning", job: job.name, runningMs: overrunMs },
        "A scheduled job is still running when its next run is due",
      );
    }, overrunMs);
    try {
      await job.run();
      deps.logger.info(
        { event: "job.finished", job: job.name, durationMs: Date.now() - startedAt.getTime() },
        "Scheduled job finished",
      );
    } catch (error) {
      deps.logger.error({ event: "job.failed", job: job.name, err: error }, "Scheduled job failed");
    } finally {
      clearTimeout(overrunning);
    }
  };

  // Claims the run, runs the job if the claim succeeded, and returns when the job is next due.
  const attempt = async (job: ScheduledJob, timing: Timing): Promise<number> => {
    const startedAt = new Date();
    let claimed: boolean;
    try {
      claimed = await deps.store.claimRun(job.name, startedAt, timing.claimCutoff(startedAt));
    } catch (error) {
      // Without a claim, another process might be running it, so don't run it now.
      deps.logger.error(
        { event: "job.claim_failed", job: job.name, err: error },
        "Couldn't claim a scheduled job's run, so it didn't run",
      );
      return timing.claimRetryMs;
    }
    if (!claimed) {
      const lastRunAt = await lookUpLastRun(job);
      return lastRunAt === "unknown"
        ? timing.msUntilNextRun(new Date())
        : timing.msUntilDue(lastRunAt, new Date());
    }
    // Stopped while claiming: don't start work during shutdown. This run is skipped.
    if (stopped) {
      return timing.msUntilNextRun(new Date());
    }
    await runJob(job, timing, startedAt);
    return timing.msUntilDue(startedAt, new Date());
  };

  // Calls the action once the wall clock reaches dueAt. Node's timers don't follow the wall clock
  // exactly and can fire a moment early by it; a weekly run started then would count towards the
  // week before and run again at the weekly time, so an early timer waits out the difference.
  const startTimer = (dueAt: number, action: () => void): void => {
    if (stopped) {
      return;
    }
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        if (Date.now() < dueAt) {
          startTimer(dueAt, action);
          return;
        }
        action();
      },
      Math.max(0, dueAt - Date.now()),
    );
    timers.add(timer);
  };

  const schedule = (job: ScheduledJob, timing: Timing, delayMs: number): void => {
    startTimer(Date.now() + delayMs, () => {
      track(
        job,
        attempt(job, timing).then((nextDelayMs) => {
          schedule(job, timing, nextDelayMs);
        }),
      );
    });
  };

  const begin = (job: ScheduledJob, timing: Timing): void => {
    track(
      job,
      lookUpLastRun(job).then((lastRunAt) => {
        if (lastRunAt !== "unknown") {
          schedule(job, timing, timing.msUntilDue(lastRunAt, new Date()));
        } else if (timing.ifLastRunUnknown === "claim-now") {
          schedule(job, timing, 0);
        } else {
          startTimer(Date.now() + weeklyRetryMs, () => {
            begin(job, timing);
          });
        }
      }),
    );
  };

  for (const [job, timing] of timings) {
    begin(job, timing);
  }

  return {
    stop: async () => {
      stopped = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      if (inProgress.size === 0) {
        return;
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timed-out">((resolve) => {
        timeout = setTimeout(() => {
          resolve("timed-out");
        }, deps.stopTimeoutMs);
      });
      const finished = Promise.all(inProgress.keys()).then(() => "finished" as const);
      const outcome = await Promise.race([finished, timedOut]);
      clearTimeout(timeout);
      if (outcome === "timed-out") {
        deps.logger.error(
          { event: "scheduler.stop_timed_out", jobs: [...new Set(inProgress.values())] },
          "Stopped without waiting for scheduled jobs still running",
        );
      }
    },
  };
}
