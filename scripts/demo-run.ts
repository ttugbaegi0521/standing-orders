// Produces the seeded headphones order's refusal by running the real thing, not by writing a row: one persisted
// cycle (workflows/standing-order/run-order.ts) over the seeded candidate and the seeded price history. It records
// the current price, runs the decide step, and persists the candidate and the decision, so the order page shows the
// chart and the skip with its fake-sale reasoning.
//
// The decide step is live Claude when ANTHROPIC_API_KEY is set (USE_LIVE_MODEL=false forces the fixture model),
// otherwise the fixture model. Search and scoring use the fixtures, so Channel3 is never called, and PayPal is
// stubbed to refuse: this script can never create or capture an order.
//
// Needs DATABASE_URL and DEMO_USER_ID, after `npm run db:migrate && npm run db:seed`.
// Usage: npm run demo-run
import { FAKE_SALE_ORDER } from "@/fixtures/demo";
import { fixtureChannel3, fixtureScoreModel, rulesDecideModel } from "@/fixtures/fakes";
import { getPool } from "@/lib/db";
import { getDecideModel, isLiveModelEnabled } from "@/lib/model";
import { consoleNotifier } from "@/lib/notify";
import type { DueOrder } from "@/lib/orders";
import type { PayPalClient } from "@/lib/paypal";
import { runOrderCycle } from "@/workflows/standing-order/run-order";

const refuse = async (): Promise<never> => {
  throw new Error("demo-run never calls PayPal");
};
const noPayPal: PayPalClient = { createAndCaptureWithVault: refuse, createOrder: refuse, captureOrder: refuse };

async function main() {
  const userId = process.env.DEMO_USER_ID;
  if (!userId) throw new Error("DEMO_USER_ID is not set");
  const db = getPool();

  const { rows } = await db.query<DueOrder>(
    `SELECT id, user_id, spec, max_price_cents, per_order_cap_cents, monthly_cap_cents, merchant_allowlist, status
       FROM standing_orders WHERE id = $1 AND user_id = $2`,
    [FAKE_SALE_ORDER.id, userId],
  );
  const order = rows[0];
  const product = FAKE_SALE_ORDER.products[0];
  if (!order) throw new Error("The seeded headphones order is missing. Run: npm run db:migrate && npm run db:seed");
  if (order.status !== "active") {
    throw new Error(`The headphones order is ${order.status}. Run npm run db:seed to reset it.`);
  }

  const [candidate, history] = await Promise.all([
    db.query("SELECT 1 FROM candidates WHERE order_id = $1 AND channel3_product_id = $2", [order.id, product.productId]),
    db.query<{ n: string }>("SELECT count(*) AS n FROM price_points WHERE product_id = $1", [product.productId]),
  ]);
  const points = Number(history.rows[0]?.n ?? 0);
  if (candidate.rows.length === 0 || points < 3) {
    throw new Error(
      `The seed data is incomplete (${candidate.rows.length} candidate rows, ${points} price points). Run: npm run db:seed`,
    );
  }

  const live = isLiveModelEnabled();
  console.log(`decide model: ${live ? "live claude" : "fake"} | seeded price points: ${points}`);

  const summary = await runOrderCycle(order, {
    db,
    channel3: fixtureChannel3(FAKE_SALE_ORDER.products),
    scoreModel: fixtureScoreModel(FAKE_SALE_ORDER.scores),
    decideModel: live ? getDecideModel() : rulesDecideModel,
    paypal: noPayPal,
    notify: consoleNotifier,
    now: () => new Date(),
  });

  console.log(`\naction:    ${summary.action}${summary.execution ? ` (execute: ${summary.execution})` : ""}`);
  console.log(`reasoning: ${summary.reasoning}`);
  if (summary.error) console.log(`error:     ${summary.error}`);
  console.log(`\nOpen: ${process.env.APP_BASE_URL || "http://localhost:3000"}/orders/${order.id}`);

  if (summary.action !== "skip") {
    console.error("\nExpected a skip on the seeded fake sale. Nothing was bought (PayPal is stubbed out).");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch {
      /* no pool to close */
    }
  });
