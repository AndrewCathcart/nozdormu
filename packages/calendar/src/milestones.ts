export const hour = 60 * 60_000;
export const day = 24 * hour;

// A date the bot counts down to. Some have a known time. For others only the day is known, and it
// may not be that day everywhere (Blizzard gives times in PST), so they get a week's notice by the
// date alone.
export type Milestone = {
  // Short, since it goes into each post's nonce, which Discord caps at 25 characters.
  readonly key: string;
  // The countdown's words, such as "WoW: Forever launches".
  readonly soon: string;
} & (
  | {
      readonly kind: "time";
      readonly at: Date;
      // The words once it's here, such as "WoW: Forever is live".
      readonly arrived: string;
    }
  // "on" is 09:00 Paris time on the day; the week's notice goes out 7 days before.
  | { readonly kind: "day"; readonly on: Date }
);

// Forever's big dates, per Blizzard: launch on 4 November 2026 at 3:00 p.m. PST (midnight on 5
// November in Paris), and Hyjal Summit and Barrow Deeps opening on 9 December, at a time not yet
// announced. When Blizzard names it, make the raids a "time" milestone.
export const foreverMilestones: readonly Milestone[] = [
  {
    key: "launch",
    kind: "time",
    at: new Date("2026-11-04T23:00:00Z"),
    soon: "WoW: Forever launches",
    arrived: "WoW: Forever is live",
  },
  {
    key: "raids",
    kind: "day",
    on: new Date("2026-12-09T08:00:00Z"),
    soon: "Hyjal Summit and Barrow Deeps open",
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

// How long after its date the last post may still go out, if the bot was down when it was due.
const lateness = 12 * hour;

// A Discord timestamp, shown in each reader's own time zone: "R" as "in 7 days", "F" as the full
// date and time.
function timestamp(time: Date, style: "R" | "F"): string {
  return `<t:${String(Math.floor(time.getTime() / 1000))}:${style}>`;
}

// "Wednesday 9 December": the date itself, the same for every reader.
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Paris",
});

interface Step {
  readonly name: string;
  readonly due: Date;
  readonly text: string;
}

// The steps' reminders, each out of date once the next is due, and the last a while after the
// milestone's date.
function inTurn(key: string, steps: readonly Step[], date: Date): Reminder[] {
  return steps.map((step, index) => ({
    key: `${key}-${step.name}`,
    due: step.due,
    until: steps[index + 1]?.due ?? new Date(date.getTime() + lateness),
    text: step.text,
  }));
}

// The posts counting down to a milestone: a week, a day and an hour before one with a known time,
// and when it arrives; a week before one with only a day.
export function remindersFor(milestone: Milestone): Reminder[] {
  if (milestone.kind === "time") {
    const { at } = milestone;
    const countdown = `⏳ **${milestone.soon} ${timestamp(at, "R")}**, on ${timestamp(at, "F")}.`;
    return inTurn(
      milestone.key,
      [
        { name: "week", due: new Date(at.getTime() - 7 * day), text: countdown },
        { name: "day", due: new Date(at.getTime() - day), text: countdown },
        { name: "hour", due: new Date(at.getTime() - hour), text: countdown },
        { name: "now", due: at, text: `🎉 **${milestone.arrived}** ${timestamp(at, "R")}.` },
      ],
      at,
    );
  }
  return inTurn(
    milestone.key,
    [
      {
        name: "week",
        due: new Date(milestone.on.getTime() - 7 * day),
        text: `⏳ **${milestone.soon} on ${dateFormat.format(milestone.on)}.** The time hasn't been announced.`,
      },
    ],
    milestone.on,
  );
}
