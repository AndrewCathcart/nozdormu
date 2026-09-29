import { describe, expect, it } from "vitest";
import { htmlToText } from "./text.ts";

describe("htmlToText", () => {
  it("keeps a numeric entity that isn't a real character as it is", () => {
    expect(htmlToText("Broken &#99999999; and &#x110000; entities")).toBe(
      "Broken &#99999999; and &#x110000; entities",
    );
  });
});
