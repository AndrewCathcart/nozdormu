import { describe, expect, it, vi } from "vitest";
import { createWagoSource } from "./wago.ts";

function respond(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("wago.tools source", () => {
  it("reads the product's latest build", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        respond(200, JSON.stringify({ product: "wow_classic_beta", version: "1.60.1.70009" })),
      );

    const version = await createWagoSource({
      fetch: fakeFetch,
      product: "wow_classic_beta",
    }).latestBuild();

    expect(version).toBe("1.60.1.70009");
    expect(fakeFetch).toHaveBeenCalledExactlyOnceWith(
      "https://wago.tools/api/builds/wow_classic_beta/latest",
      expect.anything(),
    );
  });

  it("downloads a build's ItemSparse table", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond(200, "ID,Display_lang\n1,Made-up"));

    const csv = await createWagoSource({
      fetch: fakeFetch,
      product: "wow_classic_beta",
    }).itemSparse("1.60.1.70009");

    expect(csv).toBe("ID,Display_lang\n1,Made-up");
    expect(fakeFetch).toHaveBeenCalledExactlyOnceWith(
      "https://wago.tools/db2/ItemSparse/csv?build=1.60.1.70009",
      expect.anything(),
    );
  });

  it("fails on a status other than success", async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(respond(503, "Busy"));

    await expect(
      createWagoSource({ fetch: fakeFetch, product: "wow_classic_beta" }).itemSparse(
        "1.60.1.70009",
      ),
    ).rejects.toThrow("wago.tools answered HTTP 503.");
  });

  it("sets a time limit on each download", async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(respond(200, "ID,Display_lang"));

    await createWagoSource({ fetch: fakeFetch, product: "wow_classic_beta" }).itemSparse(
      "1.60.1.70009",
    );

    expect(fakeFetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
