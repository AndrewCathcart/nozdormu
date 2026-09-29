// A date the bot counts down to. Some have a known time; for others only the day is known, so their
// posts go out at 09:00 Paris time on the day and don't claim a time.
export type Milestone = {
  // Short, since it goes into each post's nonce, which Discord caps at 25 characters.
  readonly key: string;
  // The countdown's words, such as "WoW: Forever launches".
  readonly soon: string;
  // The words once it's here, such as "WoW: Forever is live".
  readonly arrived: string;
} & (
  | {
      readonly kind: "time";
      readonly at: Date;
      // The Discord Event for it, lasting this many hours.
      readonly event: {
        readonly name: string;
        readonly description: string;
        readonly hours: number;
      };
    }
  | { readonly kind: "day"; readonly morning: Date }
);

// Forever's big dates, per Blizzard: launch on 4 November 2026 at 3:00 p.m. PST (midnight on 5
// November in Paris), and Hyjal Summit, Barrow Deeps and Onyxia's Lair opening on 9 December, at a
// time not yet announced. When Blizzard names it, make the raids a "time" milestone.
export const foreverMilestones: readonly Milestone[] = [
  {
    key: "launch",
    kind: "time",
    at: new Date("2026-11-04T23:00:00Z"),
    soon: "WoW: Forever launches",
    arrived: "WoW: Forever is live",
    event: {
      name: "WoW: Forever launch",
      description: "World of Warcraft: Forever goes live on every realm.",
      hours: 3,
    },
  },
  {
    key: "raids",
    kind: "day",
    morning: new Date("2026-12-09T08:00:00Z"),
    soon: "Hyjal Summit, Barrow Deeps and Onyxia's Lair open",
    arrived: "Hyjal Summit, Barrow Deeps and Onyxia's Lair open today",
  },
];

export interface Reminder {
  // The milestone's key and the step, such as "launch-week".
  readonly key: string;
  readonly due: Date;
  // After this it's out of date: the next step is due, or the date passed a while ago.
  readonly until: Date;
  readonly text: string;
}

const hour = 60 * 60_000;
const day = 24 * hour;

// How long after a milestone its last post may still go out, if the bot was down when it was due.
const lateness = 12 * hour;

// A Discord timestamp, shown in each reader's own time zone: "R" as "in 7 days", "F" as the full
// date and time, "D" as the date.
function timestamp(time: Date, style: "R" | "F" | "D"): string {
  return `<t:${String(Math.floor(time.getTime() / 1000))}:${style}>`;
}

interface Step {
  readonly name: string;
  readonly due: Date;
  readonly text: string;
}

// Each step's reminder is out of date once the next is due.
function reminders(key: string, steps: readonly Step[], last: Date): Reminder[] {
  return steps.map((step, index) => ({
    key: `${key}-${step.name}`,
    due: step.due,
    until: steps[index + 1]?.due ?? new Date(last.getTime() + lateness),
    text: step.text,
  }));
}

// The posts counting down to a milestone: a week, a day and an hour before one with a known time,
// and when it arrives; a week before one with only a day, and that morning.
export function remindersFor(milestone: Milestone): Reminder[] {
  if (milestone.kind === "time") {
    const { at } = milestone;
    const countdown = `**${milestone.soon} ${timestamp(at, "R")}**, on ${timestamp(at, "F")}.`;
    return reminders(
      milestone.key,
      [
        { name: "week", due: new Date(at.getTime() - 7 * day), text: `⏳ ${countdown}` },
        { name: "day", due: new Date(at.getTime() - day), text: `⏳ ${countdown}` },
        { name: "hour", due: new Date(at.getTime() - hour), text: `⏳ ${countdown}` },
        { name: "now", due: at, text: `🎉 **${milestone.arrived}.**` },
      ],
      at,
    );
  }
  const { morning } = milestone;
  return reminders(
    milestone.key,
    [
      {
        name: "week",
        due: new Date(morning.getTime() - 7 * day),
        text: `⏳ **${milestone.soon} ${timestamp(morning, "R")}**, on ${timestamp(morning, "D")}.`,
      },
      {
        name: "today",
        due: morning,
        text: `🗓️ **${milestone.arrived}.** The time hasn't been announced.`,
      },
    ],
    morning,
  );
}
