// Seeds the demo user, both demo standing orders, and their price history (relative to now).
// Idempotent: re-running resets the demo rows and seed price points.
// Usage: DATABASE_URL=postgres://... npm run db:seed
import { Client } from "pg";
import { DEMO_USER, FIXTURE_ORDERS } from "@/fixtures/demo";

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

      for (const [productId, points] of Object.entries(order.priceHistory(now))) {
        await client.query("DELETE FROM price_points WHERE product_id = $1 AND source = 'seed'", [productId]);
        await client.query(
          `INSERT INTO price_points (product_id, price_cents, observed_at, source)
           SELECT $1, unnest($2::int[]), unnest($3::timestamptz[]), 'seed'`,
          [productId, points.map((p) => p.priceCents), points.map((p) => p.observedAt)],
        );
      }
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
