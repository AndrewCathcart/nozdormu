import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Logger } from "@nozdormu/core";
import { z } from "zod";
import { formatChat } from "./chat.ts";
import type { Digest, DigestWriter } from "./digest.ts";
import { systemPrompt, userPrompt } from "./prompt.ts";

export interface ClaudeWriterDeps {
  readonly client: Anthropic;
  readonly logger: Pick<Logger, "info">;
}

const digestFormat = z.object({
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  scene: z.string(),
});

// Only the JSON schema, without the SDK's parser: its errors can quote the reply, which is written
// from members' chat and must stay out of the logs.
const digestSchema = {
  type: "json_schema",
  schema: betaZodOutputFormat(digestFormat).schema,
} as const;

function parseDigest(text: string): Digest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Claude's digest wasn't valid JSON.");
  }
  const parsed = digestFormat.safeParse(json);
  if (!parsed.success) {
    throw new Error("Claude's digest didn't match the digest format.");
  }
  return parsed.data;
}

// Writes each digest with one request to Claude Opus 5.5, streamed so a long request isn't cut off
// while waiting for the response to start. If Opus's safety classifiers decline the chat (a false
// positive, most likely), the API retries on the model Anthropic recommends for that case.
export function createClaudeWriter(deps: ClaudeWriterDeps): DigestWriter {
  return async (chat, week) => {
    const stream = deps.client.beta.messages.stream({
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      model: "claude-opus-5-5",
      max_tokens: 64_000,
      output_config: { effort: "high", format: digestSchema },
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt(formatChat(chat), week) }],
    });
    const message = await stream.finalMessage();
    // Logged whatever the outcome, since every reply is paid for. The model can be a fallback.
    deps.logger.info(
      {
        event: "digest.claude_replied",
        model: message.model,
        stopReason: message.stop_reason,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      "Claude replied",
    );
    if (message.stop_reason === "refusal") {
      throw new Error("Claude declined to write the digest.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error("Claude's digest was cut off at the token limit.");
    }
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    return parseDigest(text.join(""));
  };
}
