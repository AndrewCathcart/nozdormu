import { z } from "zod";

export interface Config {
  readonly discord: {
    readonly token: string;
    readonly applicationId: string;
    readonly guildId: string;
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

function discordId(name: string): z.ZodString {
  return required(name).regex(/^\d{17,20}$/, {
    error: `${name} must be a Discord ID (17 to 20 digits).`,
  });
}

const envSchema = z.object({
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  DISCORD_APPLICATION_ID: discordId("DISCORD_APPLICATION_ID"),
  DISCORD_GUILD_ID: discordId("DISCORD_GUILD_ID"),
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
    },
  };
}
