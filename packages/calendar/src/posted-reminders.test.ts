import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import { createPostedReminderStore } from "./posted-reminders.ts";

const database = useTestDatabase();

// Each test uses its own keys, since they share one database.
describe("posted reminder store", () => {
  it("gives the keys of the reminders posted", async () => {
    const store = createPostedReminderStore(database.db);

    await store.markPosted("made-up-week");
    await store.markPosted("made-up-day");

    const posted = await store.postedKeys();
    expect(
      ["made-up-week", "made-up-day", "made-up-never"].filter((key) => posted.has(key)),
    ).toEqual(["made-up-week", "made-up-day"]);
  });

  it("records a reminder posted twice without failing", async () => {
    const store = createPostedReminderStore(database.db);
    await store.markPosted("made-up-twice");

    await store.markPosted("made-up-twice");

    expect((await store.postedKeys()).has("made-up-twice")).toBe(true);
  });
});
