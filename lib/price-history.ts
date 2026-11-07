// Reads and writes price_points: the history that powers fake-sale detection (workflows/standing-order/price-signals.ts).
import type { PricePoint } from "@/lib/schemas";

/** The slice of a pg Pool / Client these helpers need, so tests can pass a fake. */
export interface Queryable {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
}

export interface PriceObservation {
  productId: string;
  priceCents: number;
}

const DEDUPE_WINDOW = "1 hour";

/**
 * Records today's price for each product as source 'channel3'. A product is skipped when it already has a
 * row with the same price_cents within the last hour, so frequent ticks don't pile up identical rows.
 * Returns how many rows were inserted.
 */
export async function recordPrices(
  db: Queryable,
  observations: PriceObservation[],
  now: Date = new Date(),
): Promise<number> {
  // One observation per product per call (last one wins).
  const latest = new Map<string, number>();
  for (const o of observations) {
    if (Number.isInteger(o.priceCents) && o.priceCents >= 0) latest.set(o.productId, o.priceCents);
  }
  if (latest.size === 0) return 0;

  const result = await db.query(
    `INSERT INTO price_points (product_id, price_cents, observed_at, source)
     SELECT o.product_id, o.price_cents, $3::timestamptz, 'channel3'
       FROM unnest($1::text[], $2::int[]) AS o(product_id, price_cents)
      WHERE NOT EXISTS (
        SELECT 1 FROM price_points p
         WHERE p.product_id = o.product_id
           AND p.price_cents = o.price_cents
           AND p.observed_at > $3::timestamptz - interval '${DEDUPE_WINDOW}'
      )`,
    [[...latest.keys()], [...latest.values()], now.toISOString()],
  );
  return result.rowCount ?? 0;
}

/**
 * A product's price history, oldest first, in the shape price-signals.ts takes (PricePoint).
 * Pass `before` to leave out the observation just recorded for the current run: step 3 documents its history
 * as excluding the current price, which it receives separately.
 */
export async function getPriceHistory(
  db: Queryable,
  productId: string,
  options: { before?: Date } = {},
): Promise<PricePoint[]> {
  const { rows } = await db.query<{ price_cents: number; observed_at: Date }>(
    `SELECT price_cents, observed_at
       FROM price_points
      WHERE product_id = $1 AND ($2::timestamptz IS NULL OR observed_at < $2::timestamptz)
      ORDER BY observed_at`,
    [productId, options.before?.toISOString() ?? null],
  );
  return rows.map((r) => ({ priceCents: r.price_cents, observedAt: new Date(r.observed_at).toISOString() }));
}
