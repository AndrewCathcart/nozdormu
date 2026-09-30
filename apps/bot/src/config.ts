import { z } from "zod";

export interface Config {
  readonly discord: {
    readonly token: string;
    readonly applicationId: string;
    readonly guildId: string;
  };
  readonly database: {
    readonly url: string;
  };
  readonly youtube: {
    // The Discord channel new YouTube videos are posted in.
    readonly alertChannelId: string;
  };
  readonly anthropic: {
    readonly apiKey: string;
  };
  // Paints the weekly digest's picture.
  readonly openai: {
    readonly apiKey: string;
  };
  readonly digest: {
    // The channels whose chat the weekly digest covers.
    readonly channelIds: readonly string[];
    // The channel each digest is posted in.
    readonly postChannelId: string;
  };
  readonly foreverNews: {
    // The Discord channel Forever news is posted in, such as Blizzard staff forum posts.
    readonly channelId: string;
  };
}

export type ConfigResult =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly problems: readonly string[] };

// Messages name the setting but never repeat its value, so a token can't leak into logs.
function required(name: string): z.ZodString {
  const missing = `${name} is missing.`;
  return z.string({ error: missing }).min(1, { error: missing, abort: true });
}

const discordIdPattern = /^\d{17,20}$/;

function discordId(name: string): z.ZodString {
  return required(name).regex(discordIdPattern, {
    error: `${name} must be a Discord ID (17 to 20 digits).`,
  });
}

// For example "300000000000000003,300000000000000004". Spaces around each ID are ignored.
function discordIdList(name: string) {
  return required(name)
    .transform((value) => value.split(",").map((id) => id.trim()))
    .refine((ids) => ids.every((id) => discordIdPattern.test(id)), {
      error: `${name} must be Discord IDs (17 to 20 digits) separated by commas.`,
    });
}

function isPostgresUrl(value: string): boolean {
  return URL.canParse(value) && /^postgres(ql)?:$/.test(new URL(value).protocol);
}

function postgresUrl(name: string): z.ZodString {
  return required(name).refine(isPostgresUrl, { error: `${name} must be a postgres:// URL.` });
}

const envSchema = z.object({
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  DISCORD_APPLICATION_ID: discordId("DISCORD_APPLICATION_ID"),
  DISCORD_GUILD_ID: discordId("DISCORD_GUILD_ID"),
  DATABASE_URL: postgresUrl("DATABASE_URL"),
  YOUTUBE_ALERT_CHANNEL_ID: discordId("YOUTUBE_ALERT_CHANNEL_ID"),
  ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
  OPENAI_API_KEY: required("OPENAI_API_KEY"),
  DIGEST_CHANNEL_IDS: discordIdList("DIGEST_CHANNEL_IDS"),
  DIGEST_POST_CHANNEL_ID: discordId("DIGEST_POST_CHANNEL_ID"),
  FOREVER_NEWS_CHANNEL_ID: discordId("FOREVER_NEWS_CHANNEL_ID"),
});

export function loadConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((issue) => issue.message) };
  }
  return {
    ok: true,
    config: {
      discord: {
        token: parsed.data.DISCORD_TOKEN,
        applicationId: parsed.data.DISCORD_APPLICATION_ID,
        guildId: parsed.data.DISCORD_GUILD_ID,
      },
      database: { url: parsed.data.DATABASE_URL },
      youtube: { alertChannelId: parsed.data.YOUTUBE_ALERT_CHANNEL_ID },
      anthropic: { apiKey: parsed.data.ANTHROPIC_API_KEY },
      openai: { apiKey: parsed.data.OPENAI_API_KEY },
      digest: {
        channelIds: parsed.data.DIGEST_CHANNEL_IDS,
        postChannelId: parsed.data.DIGEST_POST_CHANNEL_ID,
      },
      foreverNews: { channelId: parsed.data.FOREVER_NEWS_CHANNEL_ID },
    },
  };
}
