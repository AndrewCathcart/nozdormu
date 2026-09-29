import type { ChannelPublisher, Feature, Logger, RecentPostReader } from "@nozdormu/core";
import { type Milestone, remindersFor } from "./milestones.ts";
import type { PostedReminderStore } from "./posted-reminders.ts";
import type { ScheduledEvents } from "./scheduled-events.ts";

export interface CalendarFeatureDeps {
  // The channel Forever news is posted in.
  readonly newsChannelId: string;
  readonly milestones: readonly Milestone[];
  readonly now: () => Date;
  readonly posted: PostedReminderStore;
  readonly events: ScheduledEvents;
  readonly publish: ChannelPublisher;
  readonly recentPosts: RecentPostReader;
  readonly logger: Pick<Logger, "info">;
}

// Counts down to Forever's big dates in the news channel. Each reminder goes out once, while it's
// current: one the bot was down for is skipped once the next is due. A reminder is recorded after
// it's posted, and the bot first looks for it among its own recent messages, so one posted just
// before a crash isn't repeated.
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
    const fresh = current.filter((reminder) => !posted.has(reminder.key));
    if (fresh.length === 0) {
      return;
    }
    const recent = await deps.recentPosts(deps.newsChannelId);
    for (const reminder of fresh) {
      if (!recent.some((post) => post.content === reminder.text)) {
        await deps.publish(deps.newsChannelId, {
          content: reminder.text,
          allowed_mentions: { parse: [] },
          nonce: `cal-${reminder.key}`,
          enforce_nonce: true,
        });
      }
      await deps.posted.markPosted(reminder.key);
      deps.logger.info(
        { event: "calendar.reminded", reminder: reminder.key },
        "Posted a calendar reminder",
      );
    }
  };

  // Creates a Discord Event for each coming date with a known time, unless the server already has
  // one by that name.
  const createEvents = async (): Promise<void> => {
    const now = deps.now();
    const coming = deps.milestones.flatMap((milestone) =>
      milestone.kind === "time" && milestone.at > now ? [milestone] : [],
    );
    if (coming.length === 0) {
      return;
    }
    const existing = await deps.events.names();
    for (const milestone of coming) {
      if (existing.has(milestone.event.name)) {
        continue;
      }
      await deps.events.create({
        name: milestone.event.name,
        description: milestone.event.description,
        startsAt: milestone.at,
        endsAt: new Date(milestone.at.getTime() + milestone.event.hours * 60 * 60_000),
      });
      deps.logger.info(
        { event: "calendar.event_created", milestone: milestone.key },
        "Created a Discord Event",
      );
    }
  };

  return {
    jobs: [
      { name: "calendar.remind", intervalMs: 5 * 60_000, run: remind },
      { name: "calendar.events", intervalMs: 6 * 60 * 60_000, run: createEvents },
    ],
  };
}
