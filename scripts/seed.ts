// Seeds the demo user, both demo standing orders, and their price history (relative to now). Each order also gets
// its current candidate, so the order page can chart straight away. The decisions themselves are not seeded: run
// `npm run demo-run` to produce them (headphones: refused as a fake sale; monitor: accepted, awaiting approval).
// Idempotent: re-running resets the demo rows (including price points for the demo products, whatever their source).
// Usage: DATABASE_URL=postgres://... npm run db:seed
import { Client } from "pg";
import { DEMO_USER, FIXTURE_ORDERS } from "@/fixtures/demo";
import { analyzePriceHistory } from "@/workflows/standing-order/price-signals";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const now = new Date().toISOString();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, kill_switch = false`,
      [DEMO_USER.id, DEMO_USER.email],
    );

    for (const order of FIXTURE_ORDERS) {
      await client.query(
        `INSERT INTO standing_orders
           (id, user_id, raw_intent, spec, max_price_cents, per_order_cap_cents, monthly_cap_cents, merchant_allowlist, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         ON CONFLICT (id) DO UPDATE SET
           raw_intent = EXCLUDED.raw_intent, spec = EXCLUDED.spec, max_price_cents = EXCLUDED.max_price_cents,
           per_order_cap_cents = EXCLUDED.per_order_cap_cents, monthly_cap_cents = EXCLUDED.monthly_cap_cents,
           merchant_allowlist = EXCLUDED.merchant_allowlist, status = 'active', updated_at = now()`,
        [
          order.id,
          DEMO_USER.id,
          order.rawIntent,
          JSON.stringify(order.spec),
          order.policy.maxPriceCents,
          order.policy.perOrderCapCents,
          order.policy.monthlyCapCents,
          order.policy.merchantAllowlist,
        ],
      );
      // Clear prior demo runs for this order.
      await client.query("DELETE FROM fills WHERE order_id = $1", [order.id]);
      await client.query("DELETE FROM decisions WHERE order_id = $1", [order.id]);
      await client.query("DELETE FROM candidates WHERE order_id = $1", [order.id]);

      const history = (order.seedHistory ?? order.priceHistory)(now);
      for (const [productId, points] of Object.entries(history)) {
        // Every source: a demo run records its own observations, and a reseed should start clean.
        await client.query("DELETE FROM price_points WHERE product_id = $1", [productId]);
        await client.query(
          `INSERT INTO price_points (product_id, price_cents, observed_at, source)
           SELECT $1, unnest($2::int[]), unnest($3::timestamptz[]), 'seed'`,
          [productId, points.map((p) => p.priceCents), points.map((p) => p.observedAt)],
        );
      }
    }
    // Each demo only works if its history really reads the way it is meant to (a fake sale for the headphones,
    // a genuine drop for the monitor): check it against the real thresholds (price-signals.ts) instead of
    // trusting the numbers, and seed the candidate it belongs to (the order's top-scored fixture product).
    for (const order of FIXTURE_ORDERS) {
      if (!order.seedHistory || !order.seedExpectation) continue;
      const product = order.products[0];
      const score = order.scores.find((s) => s.productId === product.productId)!;
      const signals = analyzePriceHistory(order.seedHistory(now)[product.productId], product.priceCents, now);
      const { fakeSale, minDropPct } = order.seedExpectation;

      const problems: string[] = [];
      if (signals.fakeSale.detected !== fakeSale) {
        problems.push(`fakeSale.detected is ${signals.fakeSale.detected}, expected ${fakeSale}`);
      }
      if (minDropPct !== undefined) {
        if (signals.pctVsBaseline === null || signals.pctVsBaseline > -minDropPct) {
          problems.push(`drop vs baseline is ${signals.pctVsBaseline}, expected at least -${minDropPct}`);
        }
        if (signals.lowest30dCents !== product.priceCents) {
          problems.push(`current price is not the 30-day low (${signals.lowest30dCents})`);
        }
      }
      if (problems.length > 0) {
        throw new Error(`the seeded history for "${order.rawIntent}" is wrong: ${problems.join("; ")}`);
      }

      await client.query(
        `INSERT INTO candidates
           (order_id, channel3_product_id, merchant, title, url, price_cents, fit_score, fit_reasoning, must_haves, seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.id,
          product.productId,
          product.merchant,
          product.title,
          product.url,
          product.priceCents,
          score.fitScore,
          score.reasoning,
          JSON.stringify(score.mustHaves),
          now,
        ],
      );
    }

    await client.query("COMMIT");
    console.log(`seeded ${FIXTURE_ORDERS.length} orders for ${DEMO_USER.email}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
