import type { ChannelPublisher, Feature, Logger } from "@nozdormu/core";
import { type Milestone, remindersFor } from "./milestones.ts";
import type { PostedReminderStore } from "./posted-reminders.ts";

export interface CalendarFeatureDeps {
  // The channel Forever news is posted in.
  readonly newsChannelId: string;
  readonly milestones: readonly Milestone[];
  readonly now: () => Date;
  readonly posted: PostedReminderStore;
  readonly publish: ChannelPublisher;
  readonly logger: Pick<Logger, "info">;
}

// Counts down to Forever's big dates in the news channel. Each reminder goes out once, while it's
// current: one the bot was down for is skipped once the next is due. A reminder is recorded after
// it's posted, and carries a nonce, so Discord drops a repeat sent within a few minutes. A failed
// post doesn't stop the others; it's tried again at the next check while it's still current.
export function createCalendarFeature(deps: CalendarFeatureDeps): Feature {
  const remind = async (): Promise<void> => {
    const now = deps.now();
    const current = deps.milestones
      .flatMap(remindersFor)
      .filter((reminder) => reminder.due <= now && now < reminder.until);
    if (current.length === 0) {
      return;
    }
    const posted = await deps.posted.postedKeys();
    const failures: unknown[] = [];
    for (const reminder of current.filter((candidate) => !posted.has(candidate.key))) {
      try {
        await deps.publish(deps.newsChannelId, {
          content: reminder.text,
          allowed_mentions: { parse: [] },
          nonce: `cal-${reminder.key}`,
          enforce_nonce: true,
        });
        await deps.posted.markPosted(reminder.key);
      } catch (error) {
        failures.push(error);
        continue;
      }
      deps.logger.info(
        { event: "calendar.reminded", reminder: reminder.key },
        "Posted a calendar reminder",
      );
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Couldn't post ${String(failures.length)} calendar reminder(s).`,
      );
    }
  };

  return { jobs: [{ name: "calendar.remind", intervalMs: 5 * 60_000, run: remind }] };
}
