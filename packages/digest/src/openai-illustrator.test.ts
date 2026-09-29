import type { Logger } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import { createOpenAiIllustrator } from "./openai-illustrator.ts";

const apiKey = "sk-made-up";
const scene = "A dwarf warrior and a gnome mage cheer over a map in a crowded tavern.";

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// OpenAI's reply with a made-up three-byte picture.
const drawn = {
  created: 1_790_000_000,
  data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }],
  usage: {
    input_tokens: 109,
    output_tokens: 343,
    total_tokens: 452,
    input_tokens_details: { image_tokens: 0, text_tokens: 109 },
  },
};

function createDeps(reply: Response = json(200, drawn)) {
  return {
    fetch: vi.fn<typeof fetch>().mockResolvedValue(reply),
    apiKey,
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  };
}

describe("createOpenAiIllustrator", () => {
  it("returns the picture OpenAI drew, as a JPEG file", async () => {
    const deps = createDeps();

    const illustration = await createOpenAiIllustrator(deps)(scene);

    expect(illustration).toEqual({ name: "this-week.jpg", data: new Uint8Array([1, 2, 3]) });
  });

  it("asks OpenAI to draw the scene as a wide newspaper cartoon without writing", async () => {
    const deps = createDeps();

    await createOpenAiIllustrator(deps)(scene);

    const [url, init] = deps.fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      authorization: "Bearer sk-made-up",
      "content-type": "application/json",
    });
    expect(typeof init?.body === "string" ? JSON.parse(init.body) : undefined).toEqual({
      model: "gpt-image-2.5-sunburst",
      prompt:
        "A single-panel newspaper cartoon about a fantasy adventuring guild: clean, confident ink lines, flat muted colours, expressive comic faces and poses, and a simple, uncluttered background, in the tradition of classic magazine cartoons. The scene: A dwarf warrior and a gnome mage cheer over a map in a crowded tavern. No text, letters, speech bubbles, numbers, logos or watermarks anywhere.",
      size: "1536x1024",
      quality: "high",
      output_format: "jpeg",
      output_compression: 85,
      n: 1,
    });
  });

  it("logs the tokens each picture used, since they're paid for", async () => {
    const deps = createDeps();

    await createOpenAiIllustrator(deps)(scene);

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      {
        event: "digest.illustration_drawn",
        model: "gpt-image-2.5-sunburst",
        inputTokens: 109,
        outputTokens: 343,
      },
      "OpenAI drew this week's picture",
    );
  });

  it("fails when OpenAI's reply has no picture", async () => {
    const deps = createDeps(json(200, { ...drawn, data: [] }));

    await expect(createOpenAiIllustrator(deps)(scene)).rejects.toThrow(
      new Error("OpenAI's reply had no picture."),
    );
  });

  it("fails with OpenAI's status and error code, but none of its message, which can quote the scene", async () => {
    const deps = createDeps(
      json(400, {
        error: {
          code: "moderation_blocked",
          message: `Your request was rejected: "${scene}"`,
          type: "image_generation_user_error",
        },
      }),
    );

    await expect(createOpenAiIllustrator(deps)(scene)).rejects.toThrow(
      new Error("OpenAI answered HTTP 400 (moderation_blocked) instead of drawing."),
    );
  });
});
