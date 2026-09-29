import type { Logger } from "pino";

export interface ScheduledJob {
  // Unique across all features, e.g. "youtube.poll". Run times are stored under this name.
  readonly name: string;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
}

export interface JobRunStore {
  readonly lastRunAt: (jobName: string) => Promise<Date | undefined>;
  // Records that a run starts at startedAt, but only if the job is due: it never ran, or its last
  // run started at least intervalMs before startedAt. Returns false when it isn't due, for example
  // because another process already started this run. Must be atomic across processes.
  readonly claimRun: (jobName: string, startedAt: Date, intervalMs: number) => Promise<boolean>;
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

function checkJobs(jobs: readonly ScheduledJob[]): void {
  const names = new Set<string>();
  for (const job of jobs) {
    if (names.has(job.name)) {
      throw new Error(`The job ${job.name} is defined more than once.`);
    }
    names.add(job.name);
    if (
      !Number.isInteger(job.intervalMs) ||
      job.intervalMs < 1 ||
      job.intervalMs > maxTimerDelayMs
    ) {
      throw new Error(
        `The job ${job.name} has an interval of ${String(job.intervalMs)} ms; it must be a whole number of milliseconds from 1 to ${String(maxTimerDelayMs)}.`,
      );
    }
  }
}

// Runs each job on its own interval. A run is claimed in the store before it starts, so a job
// never runs twice at once, even across processes during a deploy, and a run that dies halfway
// isn't repeated straight away.
export function startScheduler(jobs: readonly ScheduledJob[], deps: SchedulerDeps): Scheduler {
  checkJobs(jobs);

  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  // Work in progress (startup lookups and runs), by the name of the job it belongs to.
  const inProgress = new Map<Promise<void>, string>();

  const track = (job: ScheduledJob, work: Promise<void>): void => {
    inProgress.set(work, job.name);
    void work.finally(() => inProgress.delete(work));
  };

  // Never more than one interval, so a last run recorded in the future (a skewed clock) can't
  // push the wait past what setTimeout can hold.
  const delayUntilDue = (job: ScheduledJob, lastRunAt: Date | undefined): number =>
    lastRunAt === undefined
      ? 0
      : Math.min(job.intervalMs, Math.max(0, lastRunAt.getTime() + job.intervalMs - Date.now()));

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

  const runJob = async (job: ScheduledJob, startedAt: Date): Promise<void> => {
    try {
      await job.run();
      deps.logger.info(
        { event: "job.finished", job: job.name, durationMs: Date.now() - startedAt.getTime() },
        "Scheduled job finished",
      );
    } catch (error) {
      deps.logger.error({ event: "job.failed", job: job.name, err: error }, "Scheduled job failed");
    }
  };

  // Claims the run, runs the job if the claim succeeded, and returns when the job is next due.
  const attempt = async (job: ScheduledJob): Promise<number> => {
    const startedAt = new Date();
    let claimed: boolean;
    try {
      claimed = await deps.store.claimRun(job.name, startedAt, job.intervalMs);
    } catch (error) {
      // Without a claim, another process might be running it, so don't run it now.
      deps.logger.error(
        { event: "job.claim_failed", job: job.name, err: error },
        "Couldn't claim a scheduled job's run, so it didn't run",
      );
      return job.intervalMs;
    }
    if (!claimed) {
      const lastRunAt = await lookUpLastRun(job);
      return lastRunAt === "unknown" ? job.intervalMs : delayUntilDue(job, lastRunAt);
    }
    await runJob(job, startedAt);
    return delayUntilDue(job, startedAt);
  };

  const schedule = (job: ScheduledJob, delayMs: number): void => {
    if (stopped) {
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      track(
        job,
        attempt(job).then((nextDelayMs) => {
          schedule(job, nextDelayMs);
        }),
      );
    }, delayMs);
    timers.add(timer);
  };

  for (const job of jobs) {
    // If the last run is unknown, try now: the claim still refuses a run that isn't due.
    track(
      job,
      lookUpLastRun(job).then((lastRunAt) => {
        schedule(job, lastRunAt === "unknown" ? 0 : delayUntilDue(job, lastRunAt));
      }),
    );
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
