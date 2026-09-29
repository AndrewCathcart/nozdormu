import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ChatChannel } from "./chat.ts";
import { systemPrompt } from "./prompt.ts";
import { chatMessage, lastWeek } from "./test-chat.ts";
import { createClaudeWriter } from "./writer.ts";

const week = lastWeek;

const chat = [{ name: "general", messages: [chatMessage()] }] satisfies ChatChannel[];

interface Reply {
  readonly text: string;
  readonly stopReason: "end_turn" | "max_tokens" | "refusal";
}

// A streamed Messages API response, as server-sent events.
function streamed(reply: Reply): Response {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 1 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply.text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: reply.stopReason, stop_sequence: null },
      usage: { output_tokens: 800 },
    },
    { type: "message_stop" },
  ];
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const twoSections = JSON.stringify({
  sections: [
    { heading: "Decided", body: "- Brannoc has made a spreadsheet." },
    { heading: "Highlights", body: "- Nothing yet." },
  ],
  scene: "A dwarf warrior proudly unrolls an enormous spreadsheet across a tavern table.",
  caption: "The week Brannoc made a spreadsheet.",
});

function createFakeClaude(reply: Reply = { text: twoSections, stopReason: "end_turn" }) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(streamed(reply)));
  const client = new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 });
  return { fetch, client };
}

function createFakeLogger() {
  return { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">;
}

// The JSON body of the one request sent to Claude.
function sentBody(fetch: ReturnType<typeof createFakeClaude>["fetch"]): unknown {
  const init = fetch.mock.calls[0]?.[1];
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}

describe("createClaudeWriter", () => {
  it("sends Claude the instructions for a catch-up digest and the week's chat", async () => {
    const { fetch, client } = createFakeClaude();
    const write = createClaudeWriter({ client, logger: createFakeLogger() });

    await write(chat, week);

    const body = z
      .object({
        system: z.string(),
        messages: z.array(z.object({ role: z.string(), content: z.string() })),
      })
      .parse(sentBody(fetch));
    expect(body.system).toBe(systemPrompt);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.role).toBe("user");
    expect(body.messages[0]?.content).toContain(
      "#general\n[Mon 21 Sep 09:12] Brannoc: I have made a spreadsheet.",
    );
  });

  it("returns the sections Claude wrote, and the scene and caption for the cartoon", async () => {
    const { client } = createFakeClaude();
    const write = createClaudeWriter({ client, logger: createFakeLogger() });

    const digest = await write(chat, week);

    expect(digest).toEqual({
      sections: [
        { heading: "Decided", body: "- Brannoc has made a spreadsheet." },
        { heading: "Highlights", body: "- Nothing yet." },
      ],
      cartoon: {
        scene: "A dwarf warrior proudly unrolls an enormous spreadsheet across a tavern table.",
        caption: "The week Brannoc made a spreadsheet.",
      },
    });
  });

  it("gives no cartoon when Claude describes no scene", async () => {
    const { client } = createFakeClaude({
      text: JSON.stringify({ sections: [], scene: " ", caption: "The week nothing happened." }),
      stopReason: "end_turn",
    });
    const write = createClaudeWriter({ client, logger: createFakeLogger() });

    const digest = await write(chat, week);

    expect(digest.cartoon).toBeUndefined();
  });

  it("gives the cartoon no caption when Claude writes none", async () => {
    const { client } = createFakeClaude({
      text: JSON.stringify({ sections: [], scene: "A gnome waves.", caption: "" }),
      stopReason: "end_turn",
    });
    const write = createClaudeWriter({ client, logger: createFakeLogger() });

    const digest = await write(chat, week);

    expect(digest.cartoon).toEqual({ scene: "A gnome waves.", caption: undefined });
  });

  it("asks Claude Opus 5.5, falling back to another model if it declines", async () => {
    const { fetch, client } = createFakeClaude();
    const write = createClaudeWriter({ client, logger: createFakeLogger() });

    await write(chat, week);

    // Opus 5.5 always thinks, and its thinking counts towards max_tokens, so leave it plenty.
    expect(sentBody(fetch)).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      max_tokens: 64_000,
    });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("anthropic-beta")).toContain(
      "server-side-fallback-2026-07-01",
    );
  });

  it("fails when Claude declines to write the digest", async () => {
    const { client } = createFakeClaude({ text: "", stopReason: "refusal" });
    const write = createClaudeWriter({ client, logger: createFakeLogger() });

    await expect(write(chat, week)).rejects.toThrow(
      new Error("Claude declined to write the digest."),
    );
  });

  it("fails without repeating the text when the digest is cut off", async () => {
    const { client } = createFakeClaude({
      text: '{"sections":[{"heading":"Decided","body":"- Brannoc has',
      stopReason: "max_tokens",
    });
    const write = createClaudeWriter({ client, logger: createFakeLogger() });

    await expect(write(chat, week)).rejects.toThrow(
      new Error("Claude's digest was cut off at the token limit."),
    );
  });

  it("fails without repeating the text when the reply isn't JSON", async () => {
    const { client } = createFakeClaude({
      text: "Brannoc has made a spreadsheet",
      stopReason: "end_turn",
    });
    const write = createClaudeWriter({ client, logger: createFakeLogger() });

    await expect(write(chat, week)).rejects.toThrow(
      new Error("Claude's digest wasn't valid JSON."),
    );
  });

  it("logs which model replied and how many tokens it took", async () => {
    const { client } = createFakeClaude();
    const logger = createFakeLogger();
    const write = createClaudeWriter({ client, logger });

    await write(chat, week);

    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      {
        event: "digest.claude_replied",
        model: "claude-opus-5-5",
        stopReason: "end_turn",
        inputTokens: 1200,
        outputTokens: 800,
      },
      "Claude replied",
    );
  });
});
