import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const validEnv = {
  DISCORD_TOKEN: "made-up-token",
  DISCORD_APPLICATION_ID: "100000000000000001",
  DISCORD_GUILD_ID: "200000000000000002",
};

describe("loadConfig", () => {
  it("reads the Discord settings from the environment", () => {
    expect(loadConfig(validEnv)).toEqual({
      ok: true,
      config: {
        discord: {
          token: "made-up-token",
          applicationId: "100000000000000001",
          guildId: "200000000000000002",
        },
      },
    });
  });

  it("names each missing setting, treating an empty value as missing", () => {
    expect(loadConfig({ DISCORD_TOKEN: "", DISCORD_APPLICATION_ID: "100000000000000001" })).toEqual(
      {
        ok: false,
        problems: ["DISCORD_TOKEN is missing.", "DISCORD_GUILD_ID is missing."],
      },
    );
  });

  it("names each setting that isn't a Discord ID", () => {
    expect(
      loadConfig({ ...validEnv, DISCORD_APPLICATION_ID: "not-an-id", DISCORD_GUILD_ID: "123" }),
    ).toEqual({
      ok: false,
      problems: [
        "DISCORD_APPLICATION_ID must be a Discord ID (17 to 20 digits).",
        "DISCORD_GUILD_ID must be a Discord ID (17 to 20 digits).",
      ],
    });
  });

  it("reports an empty ID once, as missing", () => {
    expect(loadConfig({ ...validEnv, DISCORD_GUILD_ID: "" })).toEqual({
      ok: false,
      problems: ["DISCORD_GUILD_ID is missing."],
    });
  });
});
