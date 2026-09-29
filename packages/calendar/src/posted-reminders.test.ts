import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import { createPostedReminderStore } from "./posted-reminders.ts";

const database = useTestDatabase();

describe("posted reminder store", () => {
  it("gives the keys of the reminders posted", async () => {
    const store = createPostedReminderStore(database.db);

    await store.markPosted("made-up-week");
    await store.markPosted("made-up-day");

    expect(await store.postedKeys()).toEqual(new Set(["made-up-week", "made-up-day"]));
  });

  it("records a reminder posted twice without failing", async () => {
    const store = createPostedReminderStore(database.db);
    await store.markPosted("made-up-twice");

    await store.markPosted("made-up-twice");

    expect([...(await store.postedKeys())].filter((key) => key === "made-up-twice")).toEqual([
      "made-up-twice",
    ]);
  });
});
