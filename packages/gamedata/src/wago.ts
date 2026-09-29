import { z } from "zod";
import type { GameDataSource } from "./build-check.ts";

export interface WagoOptions {
  readonly fetch: typeof fetch;
  // wago.tools' name for the game we follow, e.g. "wow_classic_beta" for Forever's beta.
  readonly product: string;
}

// wago.tools' name for the game Forever's data comes from. The beta runs as wow_classic_beta; check
// this again at launch (4 November 2026), when Forever may move to its own product.
export const foreverProduct = "wow_classic_beta";

const latestBuild = z.object({ version: z.string() });

// Downloads game data from wago.tools. A table is several megabytes, so allow a minute.
export function createWagoSource(options: WagoOptions): GameDataSource {
  const get = async (url: string): Promise<string> => {
    const response = await options.fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new Error(`wago.tools answered HTTP ${String(response.status)}.`);
    }
    return response.text();
  };

  return {
    latestBuild: async () => {
      const body: unknown = JSON.parse(
        await get(`https://wago.tools/api/builds/${options.product}/latest`),
      );
      return latestBuild.parse(body).version;
    },
    itemSparse: (version) =>
      get(`https://wago.tools/db2/ItemSparse/csv?build=${encodeURIComponent(version)}`),
  };
}
