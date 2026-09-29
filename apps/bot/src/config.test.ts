import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const validEnv = {
  DISCORD_TOKEN: "made-up-token",
  DISCORD_APPLICATION_ID: "100000000000000001",
  DISCORD_GUILD_ID: "200000000000000002",
  DATABASE_URL: "postgres://made-up-user:made-up-password@localhost:5432/nozdormu",
  YOUTUBE_ALERT_CHANNEL_ID: "300000000000000003",
  ANTHROPIC_API_KEY: "made-up-key",
  DIGEST_CHANNEL_IDS: "300000000000000004,300000000000000005",
  DIGEST_POST_CHANNEL_ID: "300000000000000006",
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
        database: { url: "postgres://made-up-user:made-up-password@localhost:5432/nozdormu" },
        youtube: { alertChannelId: "300000000000000003" },
        anthropic: { apiKey: "made-up-key" },
        digest: {
          channelIds: ["300000000000000004", "300000000000000005"],
          postChannelId: "300000000000000006",
        },
      },
    });
  });

  it("names each missing setting, treating an empty value as missing", () => {
    expect(loadConfig({ DISCORD_TOKEN: "", DISCORD_APPLICATION_ID: "100000000000000001" })).toEqual(
      {
        ok: false,
        problems: [
          "DISCORD_TOKEN is missing.",
          "DISCORD_GUILD_ID is missing.",
          "DATABASE_URL is missing.",
          "YOUTUBE_ALERT_CHANNEL_ID is missing.",
          "ANTHROPIC_API_KEY is missing.",
          "DIGEST_CHANNEL_IDS is missing.",
          "DIGEST_POST_CHANNEL_ID is missing.",
        ],
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

  it("reads a list of channel IDs separated by commas and spaces", () => {
    const loaded = loadConfig({
      ...validEnv,
      DIGEST_CHANNEL_IDS: " 300000000000000004, 300000000000000005 ",
    });

    expect(loaded.ok && loaded.config.digest.channelIds).toEqual([
      "300000000000000004",
      "300000000000000005",
    ]);
  });

  it("names a channel list with something in it that isn't a Discord ID, without repeating it", () => {
    expect(loadConfig({ ...validEnv, DIGEST_CHANNEL_IDS: "300000000000000004,general" })).toEqual({
      ok: false,
      problems: ["DIGEST_CHANNEL_IDS must be Discord IDs (17 to 20 digits) separated by commas."],
    });
  });

  it("reports an empty ID once, as missing", () => {
    expect(loadConfig({ ...validEnv, DISCORD_GUILD_ID: "" })).toEqual({
      ok: false,
      problems: ["DISCORD_GUILD_ID is missing."],
    });
  });

  it("names a database URL that isn't a Postgres URL, without repeating it", () => {
    expect(
      loadConfig({
        ...validEnv,
        DATABASE_URL: "mysql://made-up-user:made-up-password@localhost/db",
      }),
    ).toEqual({
      ok: false,
      problems: ["DATABASE_URL must be a postgres:// URL."],
    });
  });

  it("names a database URL that can't be parsed, without repeating it", () => {
    expect(
      loadConfig({
        ...validEnv,
        DATABASE_URL: "postgres://made-up-user:made-up-password@bad host/nozdormu",
      }),
    ).toEqual({ ok: false, problems: ["DATABASE_URL must be a postgres:// URL."] });
  });
});
