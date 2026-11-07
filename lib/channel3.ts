// Every Channel3 call goes through this file.
// POST {CHANNEL3_API_BASE}/v1/search with the x-api-key header. The API key is never logged or put in errors.
import { z } from "zod";
import type { Product } from "@/lib/schemas";

const DEFAULT_API_BASE = "https://api.trychannel3.com";
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 250;
/** Channel3's documented maximum for `limit`. */
const MAX_LIMIT = 30;

// ---- Workflow-facing client (used by workflows/standing-order/steps/search-and-score.ts) ----

export interface Channel3SearchParams {
  query: string;
  maxPriceCents?: number;
  limit?: number;
}

export interface Channel3Client {
  search(params: Channel3SearchParams): Promise<Product[]>;
}

/** The live client. Failures throw Channel3Error; nothing here falls back to fixtures. */
export function createChannel3Client(): Channel3Client {
  return {
    async search({ query, maxPriceCents, limit }) {
      const found = await searchProducts({ query, max_results: limit, max_price_cents: maxPriceCents });
      return found
        // Everything downstream is US cents, so only USD offers are usable.
        .filter((p) => p.currency === "USD")
        .map((p) => ({
          productId: p.id,
          title: p.title,
          merchant: p.merchant,
          priceCents: p.price_cents,
          url: p.url,
        }));
    },
  };
}

// ---- REST ----

export type Channel3ErrorKind = "config" | "http" | "network" | "invalid_response";

export class Channel3Error extends Error {
  constructor(
    readonly kind: Channel3ErrorKind,
    message: string,
    /** HTTP status for kind "http". */
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "Channel3Error";
  }
}

export interface Channel3Product {
  id: string;
  /** The cheapest in-stock offer's domain. */
  merchant: string;
  title: string;
  price_cents: number;
  currency: string;
  url: string;
  image_url?: string;
  brand?: string;
}

// Only the fields we use; unknown keys are ignored. Field names are from Channel3's OpenAPI spec
// (products carry `brands[]`; `brand` is accepted too in case a response uses it).
const OfferSchema = z.object({
  url: z.string().min(1),
  domain: z.string().min(1),
  price: z.object({
    price: z.number().nonnegative(),
    currency: z.string().min(1).default("USD"),
  }),
  availability: z.string(),
});

const ProductDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  brands: z.array(z.object({ name: z.string() })).nullish(),
  brand: z.string().nullish(),
  images: z.array(z.object({ url: z.string(), is_main_image: z.boolean().nullish() })).nullish(),
  offers: z.array(OfferSchema).nullish(),
});

const SearchResponseSchema = z.object({ products: z.array(ProductDetailSchema) });

function apiBase(): string {
  return (process.env.CHANNEL3_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One POST with a 10s timeout. Network errors and 5xx retry once; 4xx never retries. */
async function postSearch(body: unknown, apiKey: string): Promise<unknown> {
  let lastError: Channel3Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/v1/search`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      lastError = new Channel3Error("network", `Channel3 request failed: ${reason}`);
      continue;
    }
    if (res.status >= 500) {
      lastError = new Channel3Error("http", `Channel3 search failed with HTTP ${res.status}`, res.status);
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Channel3Error(
        "http",
        `Channel3 search failed with HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        res.status,
      );
    }
    try {
      return await res.json();
    } catch {
      throw new Channel3Error("invalid_response", "Channel3 returned a body that is not JSON");
    }
  }
  throw lastError!;
}

/**
 * Searches Channel3. Each product has several offers; the primary one is the cheapest in-stock USD offer.
 * Products with no such offer are dropped. Prices are decimal dollars in Channel3's response (the spec gives
 * no unit; "dollars and cents" is how it describes the request filter) and are converted to integer cents.
 */
export async function searchProducts(params: {
  query: string;
  max_results?: number;
  /** Sent as filters.price.max_price in dollars. */
  max_price_cents?: number;
}): Promise<Channel3Product[]> {
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) throw new Channel3Error("config", "CHANNEL3_API_KEY is not set");

  const limit = Math.min(Math.max(params.max_results ?? 20, 1), MAX_LIMIT);
  const body = {
    query: params.query,
    limit,
    filters: {
      availability: ["InStock"],
      ...(params.max_price_cents !== undefined && {
        price: { max_price: params.max_price_cents / 100 },
      }),
    },
  };

  const json = await postSearch(body, apiKey);
  const parsed = SearchResponseSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Channel3Error(
      "invalid_response",
      `Channel3 response did not match the expected shape at ${first.path.join(".") || "(root)"}: ${first.message}`,
    );
  }

  const results: Channel3Product[] = [];
  for (const p of parsed.data.products) {
    const offer = (p.offers ?? [])
      .filter((o) => o.availability === "InStock" && o.price.currency.toUpperCase() === "USD")
      .sort((a, b) => a.price.price - b.price.price)[0];
    if (!offer) continue;
    const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
    const brand = p.brands?.[0]?.name ?? p.brand ?? undefined;
    results.push({
      id: p.id,
      merchant: offer.domain,
      title: p.title,
      price_cents: Math.round(offer.price.price * 100),
      currency: "USD",
      url: offer.url,
      ...(image && { image_url: image.url }),
      ...(brand && { brand }),
    });
  }
  return results.slice(0, limit);
}
