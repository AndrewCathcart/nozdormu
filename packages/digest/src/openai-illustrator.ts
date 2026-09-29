import type { Logger } from "@nozdormu/core";
import { z } from "zod";
import type { Illustrator } from "./digest.ts";

export interface OpenAiIllustratorDeps {
  readonly fetch: typeof fetch;
  readonly apiKey: string;
  readonly logger: Pick<Logger, "info">;
}

// The same style every week, around the scene Claude described: a newspaper cartoon, which reads
// well at Discord's preview size, where a glossy painting looked generic. The model draws writing
// badly, so the picture has none.
function paintingPrompt(scene: string): string {
  return `A single-panel newspaper cartoon about a fantasy adventuring guild: clean, confident ink lines, flat muted colours, expressive comic faces and poses, and a simple, uncluttered background, in the tradition of classic magazine cartoons. The scene: ${scene} No text, letters, speech bubbles, numbers, logos or watermarks anywhere.`;
}

// OpenAI's error message can quote the prompt, which comes from members' chat, so only its code is
// kept.
const failure = z.object({ error: z.object({ code: z.string().nullable() }) });

const drawing = z.object({
  data: z.array(z.object({ b64_json: z.string() })),
  usage: z.object({ input_tokens: z.int(), output_tokens: z.int() }),
});

const model = "gpt-image-2.5-sunburst";

// Draws each digest's picture with OpenAI's gpt-image-2.5-sunburst, the more detailed of its two
// newest models: at high quality, 1536 × 1024 takes about 40 seconds and costs about $0.04.
export function createOpenAiIllustrator(deps: OpenAiIllustratorDeps): Illustrator {
  return async (scene) => {
    const response = await deps.fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${deps.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: paintingPrompt(scene),
        size: "1536x1024",
        quality: "high",
        output_format: "jpeg",
        output_compression: 85,
        n: 1,
      }),
      // Drawing can take up to two minutes.
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const parsed = failure.safeParse(await response.json().catch(() => undefined));
      const code =
        parsed.success && parsed.data.error.code !== null ? ` (${parsed.data.error.code})` : "";
      throw new Error(`OpenAI answered HTTP ${String(response.status)}${code} instead of drawing.`);
    }
    const { data, usage } = drawing.parse(await response.json());
    // Logged for every reply with a picture, since each is paid for.
    deps.logger.info(
      {
        event: "digest.illustration_drawn",
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
      "OpenAI drew this week's picture",
    );
    const [picture] = data;
    if (picture === undefined) {
      throw new Error("OpenAI's reply had no picture.");
    }
    return {
      data: new Uint8Array(Buffer.from(picture.b64_json, "base64")),
      name: "this-week.jpg",
    };
  };
}
