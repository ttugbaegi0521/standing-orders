// lib/channel3.ts against a mocked fetch. Never calls the live API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Channel3Error, createChannel3Client, searchProducts } from "@/lib/channel3";

const KEY = "test-key-do-not-leak";

function product(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `p${i}`,
    title: `Monitor ${i}`,
    brands: [{ id: "b1", name: "Acme" }],
    images: [{ url: `https://img/${i}-b.jpg` }, { url: `https://img/${i}-a.jpg`, is_main_image: true }],
    offers: [
      { url: `https://shop-a.com/${i}`, domain: "shop-a.com", price: { price: 299.99, currency: "USD" }, availability: "InStock" },
      { url: `https://shop-b.com/${i}`, domain: "shop-b.com", price: { price: 249.5, currency: "USD" }, availability: "InStock" },
      { url: `https://shop-c.com/${i}`, domain: "shop-c.com", price: { price: 199, currency: "USD" }, availability: "OutOfStock" },
    ],
    ...over,
  };
}

const ok = (products: unknown[]) => new Response(JSON.stringify({ products }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CHANNEL3_API_KEY", KEY);
  vi.stubEnv("CHANNEL3_API_BASE", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("searchProducts", () => {
  it("returns typed products: cheapest in-stock offer, integer cents, image and brand", async () => {
    fetchMock.mockResolvedValueOnce(ok(Array.from({ length: 10 }, (_, i) => product(i))));
    const results = await searchProducts({ query: "27 inch monitor", max_results: 10 });

    expect(results).toHaveLength(10);
    expect(results[0]).toEqual({
      id: "p0",
      merchant: "shop-b.com", // the cheaper offer (shop-c) is out of stock
      title: "Monitor 0",
      price_cents: 24950,
      currency: "USD",
      url: "https://shop-b.com/0",
      image_url: "https://img/0-a.jpg",
      brand: "Acme",
    });
  });

  it("sends the documented request: URL, key header, query, limit, in-stock filter", async () => {
    fetchMock.mockResolvedValueOnce(ok([]));
    await searchProducts({ query: "monitor", max_results: 5, max_price_cents: 30000 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.trychannel3.com/v1/search");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe(KEY);
    expect(JSON.parse(init.body)).toEqual({
      query: "monitor",
      limit: 5,
      filters: { availability: ["InStock"], price: { max_price: 300 } },
    });
  });

  it("uses CHANNEL3_API_BASE when set", async () => {
    vi.stubEnv("CHANNEL3_API_BASE", "https://example.test/");
    fetchMock.mockResolvedValueOnce(ok([]));
    await searchProducts({ query: "x" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/search");
  });

  it("handles empty results, and drops products with no in-stock USD offer", async () => {
    fetchMock.mockResolvedValueOnce(ok([]));
    expect(await searchProducts({ query: "nothing" })).toEqual([]);

    fetchMock.mockResolvedValueOnce(
      ok([
        product(1, { offers: [{ url: "https://a.com", domain: "a.com", price: { price: 10, currency: "USD" }, availability: "OutOfStock" }] }),
        product(2, { offers: [{ url: "https://a.com", domain: "a.com", price: { price: 10, currency: "EUR" }, availability: "InStock" }] }),
        product(3, { offers: undefined }),
        product(4),
      ]),
    );
    const results = await searchProducts({ query: "x" });
    expect(results.map((r) => r.id)).toEqual(["p4"]);
  });

  it("retries once on a 5xx, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("upstream down", { status: 503 }))
      .mockResolvedValueOnce(ok([product(1)]));
    const results = await searchProducts({ query: "x" });
    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on a network error, then gives up with a typed error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(searchProducts({ query: "x" })).rejects.toMatchObject({ name: "Channel3Error", kind: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 5xx", async () => {
    fetchMock.mockImplementation(async () => new Response("bad", { status: 502 }));
    await expect(searchProducts({ query: "x" })).rejects.toMatchObject({ kind: "http", status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx", async () => {
    fetchMock.mockResolvedValue(new Response("invalid api key", { status: 401 }));
    const err = await searchProducts({ query: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(Channel3Error);
    expect(err).toMatchObject({ kind: "http", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a typed error when the response shape is wrong", async () => {
    fetchMock.mockResolvedValueOnce(
      ok([product(1, { offers: [{ url: "https://a.com", domain: "a.com", price: { price: "free" }, availability: "InStock" }] })]),
    );
    await expect(searchProducts({ query: "x" })).rejects.toMatchObject({ kind: "invalid_response" });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    await expect(searchProducts({ query: "x" })).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("fails fast without a key, and never puts the key in an error", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "");
    await expect(searchProducts({ query: "x" })).rejects.toMatchObject({ kind: "config" });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("CHANNEL3_API_KEY", KEY);
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    const err = await searchProducts({ query: "x" }).catch((e) => e);
    expect(String(err.message)).not.toContain(KEY);
  });
});

describe("createChannel3Client", () => {
  it("maps results to the workflow Product shape", async () => {
    fetchMock.mockResolvedValueOnce(ok([product(1)]));
    const products = await createChannel3Client().search({ query: "monitor", limit: 30 });
    expect(products).toEqual([
      { productId: "p1", title: "Monitor 1", merchant: "shop-b.com", priceCents: 24950, url: "https://shop-b.com/1" },
    ]);
  });
});
